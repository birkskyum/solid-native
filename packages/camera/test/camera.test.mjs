import assert from "node:assert/strict";
import test from "node:test";
import { createRoot, flush } from "solid-js";

import { createCameraService } from "../dist/index.js";
import { resolveNitroHybridObject } from "../dist/nitro-adapter.js";
import { createOwnedCameraSession } from "../dist/solid.js";

test("installs one pinned Nitro hybrid object without a React facade", () => {
  const cameraFactory = { name: "camera-factory" };
  const calls = [];
  const globals = {};
  const proxy = {
    version: "0.36.5",
    createHybridObject(name) {
      calls.push(["create", name]);
      return cameraFactory;
    },
  };
  const registry = {
    getEnforcing(name) {
      calls.push(["registry", name]);
      return {
        install() {
          calls.push(["install"]);
          globals.NitroModulesProxy = proxy;
        },
      };
    },
  };

  assert.equal(
    resolveNitroHybridObject(registry, globals, "0.36.5", "CameraFactory"),
    cameraFactory,
  );
  assert.deepEqual(calls, [
    ["registry", "NitroModules"],
    ["install"],
    ["create", "CameraFactory"],
  ]);

  calls.length = 0;
  assert.equal(
    resolveNitroHybridObject(
      {
        getEnforcing() {
          throw new Error("must not reinstall");
        },
      },
      globals,
      "0.36.5",
      "CameraFactory",
    ),
    cameraFactory,
  );
  assert.deepEqual(calls, [["create", "CameraFactory"]]);
});

test("accepts Android's null Nitro installer success result", () => {
  const cameraFactory = { name: "android-camera-factory" };
  const globals = {};
  const registry = {
    getEnforcing() {
      return {
        install() {
          globals.NitroModulesProxy = {
            version: "0.36.5",
            createHybridObject() {
              return cameraFactory;
            },
          };
          return null;
        },
      };
    },
  };

  assert.equal(
    resolveNitroHybridObject(registry, globals, "0.36.5", "CameraFactory"),
    cameraFactory,
  );
});

test("rejects malformed or mismatched Nitro installation boundaries", () => {
  const matchingProxy = {
    version: "0.36.5",
    createHybridObject() {
      return {};
    },
  };
  const registry = (install) => ({
    getEnforcing() {
      return { install };
    },
  });

  assert.throws(
    () =>
      resolveNitroHybridObject(
        registry(() => "native install failed"),
        {},
        "0.36.5",
        "CameraFactory",
      ),
    /native install failed/u,
  );
  assert.throws(
    () =>
      resolveNitroHybridObject(
        registry(() => 1),
        {},
        "0.36.5",
        "CameraFactory",
      ),
    /invalid result/u,
  );
  assert.throws(
    () =>
      resolveNitroHybridObject(
        registry(() => undefined),
        {},
        "0.36.5",
        "CameraFactory",
      ),
    /did not publish/u,
  );
  assert.throws(
    () =>
      resolveNitroHybridObject(
        registry(() => undefined),
        { NitroModulesProxy: { ...matchingProxy, version: "0.36.4" } },
        "0.36.5",
        "CameraFactory",
      ),
    /must be 0\.36\.5/u,
  );
  assert.throws(
    () =>
      resolveNitroHybridObject(
        registry(() => undefined),
        {
          NitroModulesProxy: {
            version: "0.36.5",
            createHybridObject() {
              return null;
            },
          },
        },
        "0.36.5",
        "CameraFactory",
      ),
    /did not create/u,
  );
  assert.throws(
    () =>
      resolveNitroHybridObject(
        registry(() => undefined),
        { NitroModulesProxy: matchingProxy },
        "bad version",
        "CameraFactory",
      ),
    /version is invalid/u,
  );
});

function memoryAdapter() {
  const listeners = new Set();
  let stopCalls = 0;
  const captureCalls = [];
  const adapter = {
    authorization: "authorized",
    devices: [
      {
        id: "back-wide",
        name: "Back Wide Camera",
        position: "back",
        type: "wide-angle",
      },
    ],
    get stopCalls() {
      return stopCalls;
    },
    get captureCalls() {
      return captureCalls;
    },
    getPermission() {
      return { authorization: this.authorization };
    },
    async requestPermission() {
      this.authorization = "authorized";
      return { authorization: this.authorization };
    },
    async listDevices() {
      return this.devices;
    },
    async open(position) {
      const selected = this.devices.find(
        (device) => device.position === position,
      );
      if (selected === undefined) throw new Error("missing camera");
      return {
        device: selected,
        async capturePhoto(options) {
          captureCalls.push(options);
          return {
            filePath: "/tmp/solid-native-photo.jpg",
            width: 640,
            height: 480,
            orientation: "right",
            containerFormat: "jpeg",
            timestamp: 12.5,
            isMirrored: false,
          };
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async stop() {
          stopCalls += 1;
          adapter.emit({ kind: "stopped" });
        },
      };
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
  };
  return adapter;
}

test("validates camera permission, devices, sessions, and idempotent stop", async () => {
  const adapter = memoryAdapter();
  const service = createCameraService(adapter);

  adapter.authorization = "not-determined";
  assert.deepEqual(service.getPermission(), {
    authorization: "not-determined",
  });
  assert.deepEqual(await service.requestPermission(), {
    authorization: "authorized",
  });
  assert.deepEqual(await service.listDevices(), adapter.devices);
  const session = await service.open("back");
  assert.equal(session.device.id, "back-wide");
  const photo = await session.capturePhoto({ enableShutterSound: false });
  assert.deepEqual(photo, {
    filePath: "/tmp/solid-native-photo.jpg",
    width: 640,
    height: 480,
    orientation: "right",
    containerFormat: "jpeg",
    timestamp: 12.5,
    isMirrored: false,
  });
  assert.equal(Object.isFrozen(photo), true);
  assert.deepEqual(adapter.captureCalls, [
    { flashMode: "off", enableShutterSound: false },
  ]);
  await Promise.all([session.stop(), session.stop()]);
  assert.equal(adapter.stopCalls, 1);
  assert.equal(session.stopped, true);
  assert.throws(() => session.subscribe(() => undefined), /stopped/);
  await assert.rejects(session.capturePhoto(), /stopped/);
});

test("rejects malformed adapters, permissions, device lists, and sessions", async () => {
  assert.throws(() => createCameraService({}), /getPermission/);
  const adapter = memoryAdapter();
  const service = createCameraService(adapter);

  adapter.authorization = "maybe";
  assert.throws(() => service.getPermission(), /authorization status/);
  adapter.authorization = "denied";
  await assert.rejects(service.open("back"), /must be authorized/);
  adapter.authorization = "authorized";
  adapter.devices = [adapter.devices[0], adapter.devices[0]];
  await assert.rejects(service.listDevices(), /must be unique/);
  adapter.devices = [
    { id: "wrong", name: "Front", position: "front", type: "wide-angle" },
  ];
  const open = adapter.open.bind(adapter);
  adapter.open = () => open("front");
  await assert.rejects(service.open("back"), /different device position/);
  assert.equal(adapter.stopCalls, 1);
});

test("rejects malformed capture options and photo results", async () => {
  const adapter = memoryAdapter();
  const service = createCameraService(adapter);
  const session = await service.open("back");

  await assert.rejects(
    session.capturePhoto({ flashMode: "torch" }),
    /flash mode/,
  );
  await assert.rejects(
    session.capturePhoto({ enableShutterSound: "yes" }),
    /must be a boolean/,
  );

  const open = adapter.open.bind(adapter);
  adapter.open = async (position) => {
    const adapterSession = await open(position);
    adapterSession.capturePhoto = async () => ({
      filePath: "",
      width: 0,
      height: 480,
      orientation: "up",
      containerFormat: "jpeg",
      timestamp: 0,
      isMirrored: false,
    });
    return adapterSession;
  };
  const malformedSession = await service.open("back");
  await assert.rejects(malformedSession.capturePhoto(), /file path/);
  await malformedSession.stop();
  await session.stop();
});

test("normalizes session events and isolates listener failures", async () => {
  const adapter = memoryAdapter();
  const service = createCameraService(adapter);
  const session = await service.open("back");
  const errors = [];
  const events = [];
  session.subscribe(
    async (event) => {
      events.push(event);
      if (event.kind === "interrupted") {
        throw new Error("listener failed");
      }
    },
    {
      async onError(error) {
        errors.push(error);
        throw new Error("diagnostic failed");
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, [{ kind: "started" }]);
  adapter.emit({ kind: "interrupted", reason: "system-pressure" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(errors.length, 1);
  assert.deepEqual(events, [
    { kind: "started" },
    { kind: "interrupted", reason: "system-pressure" },
  ]);
  adapter.emit({ kind: "started" });
  assert.equal(events.length, 2);
  adapter.emit({ kind: "unsupported" });
  assert.equal(errors.length, 2);
  await session.stop();
});

test("stops an asynchronously opened camera with its Solid owner", async () => {
  const adapter = memoryAdapter();
  const service = createCameraService(adapter);
  const errors = [];
  let disposeOwner;
  let owned;
  createRoot((dispose) => {
    disposeOwner = dispose;
    owned = createOwnedCameraSession(service, {
      position: "back",
      onError: (error) => errors.push(error),
    });
  });

  await owned.ready;
  await flush();
  assert.equal(owned.state(), "running");
  assert.equal(owned.device().id, "back-wide");
  disposeOwner();
  await owned.stop();
  await flush();
  assert.equal(owned.state(), "stopped");
  assert.equal(adapter.stopCalls, 1);
  assert.deepEqual(errors, []);
});

test("stops a camera that finishes opening after its Solid owner is disposed", async () => {
  const adapter = memoryAdapter();
  const open = adapter.open.bind(adapter);
  let releaseOpen;
  adapter.open = (position) =>
    new Promise((resolve) => {
      releaseOpen = () => resolve(open(position));
    });
  const service = createCameraService(adapter);
  let disposeOwner;
  let owned;
  createRoot((dispose) => {
    disposeOwner = dispose;
    owned = createOwnedCameraSession(service, { position: "back" });
  });

  disposeOwner();
  await flush();
  assert.equal(owned.state(), "stopping");
  releaseOpen();
  await owned.stop();
  await flush();
  assert.equal(owned.state(), "stopped");
  assert.equal(adapter.stopCalls, 1);
});

test("reports an asynchronous opening failure once", async () => {
  const adapter = memoryAdapter();
  const openingFailure = new Error("camera failed to open");
  adapter.open = async () => {
    throw openingFailure;
  };
  const service = createCameraService(adapter);
  const errors = [];
  let disposeOwner;
  let owned;
  createRoot((dispose) => {
    disposeOwner = dispose;
    owned = createOwnedCameraSession(service, {
      position: "back",
      onError: (error) => errors.push(error),
    });
  });

  await assert.rejects(owned.ready, openingFailure);
  await flush();
  assert.equal(owned.state(), "failed");
  assert.deepEqual(errors, [openingFailure]);
  await assert.rejects(owned.stop(), openingFailure);
  assert.deepEqual(errors, [openingFailure]);
  disposeOwner();
});
