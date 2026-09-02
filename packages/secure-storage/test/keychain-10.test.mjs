import assert from "node:assert/strict";
import test from "node:test";

import { createKeychain10SecureStorage } from "../dist/keychain-10.js";

function nativeModule() {
  const values = new Map();
  const calls = [];
  return {
    calls,
    values,
    marker: "native-this",
    async setGenericPasswordForOptions(options, username, password) {
      assert.equal(this.marker, "native-this");
      assert.ok(Object.isFrozen(options));
      assert.ok(Object.isFrozen(options.authenticationPrompt));
      calls.push(["set", options, username, password]);
      values.set(options.service, { password, username });
      return { service: options.service, storage: "keychain" };
    },
    async getGenericPasswordForOptions(options) {
      assert.equal(this.marker, "native-this");
      assert.ok(Object.isFrozen(options));
      assert.ok(Object.isFrozen(options.authenticationPrompt));
      calls.push(["get", options]);
      const credentials = values.get(options.service);
      return credentials === undefined
        ? false
        : {
            ...credentials,
            service: options.service,
            storage: "keychain",
          };
    },
    async resetGenericPasswordForOptions(options) {
      assert.equal(this.marker, "native-this");
      assert.ok(Object.isFrozen(options));
      assert.ok(Object.isFrozen(options.authenticationPrompt));
      calls.push(["remove", options]);
      values.delete(options.service);
      return true;
    },
  };
}

test("maps keys and empty values to the exact Keychain 10 ABI", async () => {
  const native = nativeModule();
  const storage = createKeychain10SecureStorage(native, {
    servicePrefix: "dev.solidnative.session",
  });

  assert.equal(await storage.getItem("refresh"), null);
  await storage.setItem("refresh", "");
  assert.equal(await storage.getItem("refresh"), "");
  await storage.removeItem("refresh");
  assert.equal(await storage.getItem("refresh"), null);

  const service = "dev.solidnative.session:refresh";
  const authenticationPrompt = {
    cancel: "Cancel",
    title: "Authenticate to retrieve secret",
  };
  const readOptions = { authenticationPrompt, cloudSync: false, service };
  assert.deepEqual(native.calls, [
    ["get", readOptions],
    [
      "set",
      {
        accessible: "AccessibleWhenUnlockedThisDeviceOnly",
        authenticationPrompt,
        cloudSync: false,
        securityLevel: "SECURE_SOFTWARE",
        service,
      },
      "solid-native.secure-storage/v1",
      "solid-native:v1:",
    ],
    ["get", readOptions],
    ["remove", readOptions],
    ["get", readOptions],
  ]);
});

test("supports explicit device availability and hardware policies", async () => {
  const native = nativeModule();
  const storage = createKeychain10SecureStorage(native, {
    servicePrefix: "dev.solidnative.session",
    iosAccessibility: "after-first-unlock-device-only",
    androidSecurity: "hardware",
  });

  await storage.setItem("token", "private");
  assert.deepEqual(native.calls[0][1], {
    accessible: "AccessibleAfterFirstUnlockThisDeviceOnly",
    authenticationPrompt: {
      cancel: "Cancel",
      title: "Authenticate to retrieve secret",
    },
    cloudSync: false,
    securityLevel: "SECURE_HARDWARE",
    service: "dev.solidnative.session:token",
  });
});

test("fails closed for malformed modules, options, and native results", async () => {
  assert.throws(
    () => createKeychain10SecureStorage({}, { servicePrefix: "test" }),
    /generic-password/u,
  );
  assert.throws(
    () => createKeychain10SecureStorage(nativeModule(), null),
    /options/u,
  );
  for (const prefix of ["", "bad:", "bad\0prefix", "x".repeat(97)]) {
    assert.throws(
      () =>
        createKeychain10SecureStorage(nativeModule(), {
          servicePrefix: prefix,
        }),
      /servicePrefix/u,
    );
  }
  assert.throws(
    () =>
      createKeychain10SecureStorage(nativeModule(), {
        servicePrefix: "test",
        iosAccessibility: "always",
      }),
    /accessibility/u,
  );
  assert.throws(
    () =>
      createKeychain10SecureStorage(nativeModule(), {
        servicePrefix: "test",
        androidSecurity: "none",
      }),
    /security/u,
  );

  const malformed = (overrides) =>
    createKeychain10SecureStorage(
      {
        ...nativeModule(),
        ...overrides,
      },
      { servicePrefix: "test" },
    );
  await assert.rejects(
    malformed({
      async setGenericPasswordForOptions() {
        return true;
      },
    }).setItem("token", "private"),
    /write result/u,
  );
  await assert.rejects(
    malformed({
      async getGenericPasswordForOptions() {
        return {
          service: "other:token",
          storage: "keychain",
          username: "solid-native.secure-storage/v1",
          password: "solid-native:v1:private",
        };
      },
    }).getItem("token"),
    /outside the requested/u,
  );
  await assert.rejects(
    malformed({
      async resetGenericPasswordForOptions() {
        return false;
      },
    }).removeItem("token"),
    /did not confirm/u,
  );
});
