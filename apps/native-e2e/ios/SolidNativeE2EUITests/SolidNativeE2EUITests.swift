import XCTest

final class SolidNativeE2EUITests: XCTestCase {
  private func waitForPredicate(
    _ predicate: NSPredicate,
    evaluatedWith object: Any,
    timeout: TimeInterval,
    failureMessage: String,
    file: StaticString = #filePath,
    line: UInt = #line
  ) -> Bool {
    let expectation = XCTNSPredicateExpectation(
      predicate: predicate,
      object: object
    )
    let result = XCTWaiter.wait(for: [expectation], timeout: timeout)
    guard result == .completed else {
      XCTFail(failureMessage, file: file, line: line)
      return false
    }
    return true
  }

  private func tapDevelopmentControl(
    _ application: XCUIApplication,
    label: String,
    file: StaticString = #filePath,
    line: UInt = #line
  ) -> Bool {
    let control = application.buttons[label].firstMatch
    guard control.waitForExistence(timeout: 10), control.isHittable else {
      XCTFail(
        "The Solid Native development control \(label) was not hittable.",
        file: file,
        line: line
      )
      return false
    }
    control.tap()
    return true
  }

  func testDevelopmentOverlayOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let removed = NSPredicate(format: "exists == false")
    application.terminate()
    application.launchArguments += ["--solid-native-use-bundled-development"]
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The bundled Solid Native development application did not launch.")
      return
    }

    let ready = application.staticTexts["Solid Native development overlay ready"].firstMatch
    guard ready.waitForExistence(timeout: 10) else {
      XCTFail("The Solid Native development overlay did not mount.")
      return
    }

    for _ in 0..<2 {
      guard tapDevelopmentControl(
        application,
        label: "Open network inspector (0 retained requests)"
      ) else { return }
      let networkTitle = application.staticTexts["Native network"].firstMatch
      guard networkTitle.waitForExistence(timeout: 5) else {
        XCTFail("The native network inspector did not open.")
        return
      }
      guard tapDevelopmentControl(
        application,
        label: "Close network inspector"
      ) else { return }
      guard waitForPredicate(
        removed,
        evaluatedWith: networkTitle,
        timeout: 5,
        failureMessage: "The native network inspector survived dismissal."
      ) else { return }
    }

    guard tapDevelopmentControl(
      application,
      label: "Open causal trace inspector"
    ) else { return }
    let causalTitle = application.staticTexts["Causal trace"].firstMatch
    guard causalTitle.waitForExistence(timeout: 5) else {
      XCTFail("The native causal inspector did not open.")
      return
    }
    guard tapDevelopmentControl(
      application,
      label: "Close causal trace inspector"
    ) else { return }
    guard waitForPredicate(
      removed,
      evaluatedWith: causalTitle,
      timeout: 5,
      failureMessage: "The native causal inspector survived dismissal."
    ) else { return }

    guard tapDevelopmentControl(
      application,
      label: "Open causal trace inspector"
    ) else { return }
    guard tapDevelopmentControl(
      application,
      label: "Start Solid diagnostics capture"
    ) else { return }
    guard tapDevelopmentControl(
      application,
      label: "Exercise Solid diagnostics capture"
    ) else { return }
    let diagnosticsUpdated = application.staticTexts["Solid diagnostics updates: 1"].firstMatch
    guard diagnosticsUpdated.waitForExistence(timeout: 5) else {
      XCTFail("The Solid diagnostics workload did not update.")
      return
    }
    guard tapDevelopmentControl(
      application,
      label: "Stop Solid diagnostics capture"
    ) else { return }
    let correlation = application.staticTexts.matching(
      NSPredicate(format: "label CONTAINS[c] %@", "native correlation")
    ).firstMatch
    guard correlation.waitForExistence(timeout: 5) else {
      XCTFail("The on-device Solid/native correlation did not appear.")
      return
    }
    let correlationRow = application.staticTexts[
      "solid-native.devtools.diagnostics.output · 1 reruns · 1 frames"
    ].firstMatch
    guard correlationRow.waitForExistence(timeout: 5) else {
      XCTFail("The on-device Solid/native correlation row was incomplete.")
      return
    }
    XCTAssertFalse(
      application.staticTexts["solid-native.devtools.diagnostics.counter"].exists,
      "The on-device correlation exposed a diagnostic cause name."
    )
    guard tapDevelopmentControl(
      application,
      label: "Close causal trace inspector"
    ) else { return }

    guard tapDevelopmentControl(
      application,
      label: "Report async development error"
    ) else { return }
    XCTAssertTrue(application.staticTexts["Physical async failure"].waitForExistence(timeout: 5))
    guard tapDevelopmentControl(
      application,
      label: "Dismiss development error"
    ) else { return }
    XCTAssertTrue(application.staticTexts["Async overlay recovered"].waitForExistence(timeout: 5))

    guard tapDevelopmentControl(
      application,
      label: "Report guarded Hermes error"
    ) else { return }
    XCTAssertTrue(
      application.staticTexts["Physical guarded Hermes failure"].waitForExistence(timeout: 5)
    )
    guard tapDevelopmentControl(
      application,
      label: "Dismiss development error"
    ) else { return }
    XCTAssertTrue(application.staticTexts["Runtime overlay recovered"].waitForExistence(timeout: 5))

    guard tapDevelopmentControl(
      application,
      label: "Throw Solid render error"
    ) else { return }
    XCTAssertTrue(
      application.staticTexts["Physical Solid render failure"].waitForExistence(timeout: 5)
    )
    guard tapDevelopmentControl(
      application,
      label: "Retry failed Solid subtree"
    ) else { return }
    let recovered = application.staticTexts["Render overlay recovered"].firstMatch
    guard recovered.waitForExistence(timeout: 5) else {
      XCTFail("The failed Solid subtree did not recover.")
      return
    }

    guard tapDevelopmentControl(
      application,
      label: "Dispose development overlay proof"
    ) else { return }
    guard waitForPredicate(
      removed,
      evaluatedWith: recovered,
      timeout: 8,
      failureMessage: "The Solid Native development surface survived terminal teardown."
    ) else { return }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testMemoryWarningOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let removed = NSPredicate(format: "exists == false")
    // This runner intentionally fixes the bundle ID below. Keep it aligned with
    // ios-memory-warning-test.sh so the proof URL targets the already-running app.
    let warningURL = try XCTUnwrap(
      URL(string: "dev.solidnative.memorywarning://memory-warning-proof")
    )

    application.terminate()
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The memory-warning application did not launch.")
      return
    }

    let status = application.staticTexts["solid-native-memory-warning-status"]
    guard status.waitForExistence(timeout: 10) else {
      XCTFail("The Solid-owned memory-warning subscription did not mount.")
      return
    }
    XCTAssertEqual(status.label, "Solid Native memory-warning proof ready")
    XCUIDevice.shared.system.open(warningURL)
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The native memory-warning proof URL did not return to the application.")
      return
    }

    let succeeded = NSPredicate(
      format: "label == %@",
      "Solid Native memory-warning causal proof succeeded"
    )
    guard waitForPredicate(
      succeeded,
      evaluatedWith: status,
      timeout: 20,
      failureMessage: "The injected process memory warning did not complete its causal Fabric proof."
    ) else {
      return
    }

    let count = application.staticTexts["solid-native-memory-warning-count"]
    guard count.waitForExistence(timeout: 5) else {
      XCTFail("The memory-warning count did not remain mounted after verification.")
      return
    }
    XCTAssertEqual(count.label, "Memory warnings 1")

    let dispose = application.buttons["Dispose Solid Native memory-warning proof"]
    guard dispose.waitForExistence(timeout: 5), dispose.isHittable else {
      XCTFail("The memory-warning teardown control was not hittable.")
      return
    }
    dispose.tap()
    guard waitForPredicate(
      removed,
      evaluatedWith: status,
      timeout: 8,
      failureMessage: "The memory-warning surface survived terminal owner teardown."
    ) else {
      return
    }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testPlatformReactivityOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let device = XCUIDevice.shared
    let originalAppearance = device.appearance
    let originalOrientation = device.orientation
    let restorationOrientation: UIDeviceOrientation
    switch originalOrientation {
    case .portrait, .portraitUpsideDown, .landscapeLeft, .landscapeRight:
      restorationOrientation = originalOrientation
    default:
      restorationOrientation = .portrait
    }
    defer {
      device.appearance = originalAppearance
      device.orientation = restorationOrientation
    }

    func tapControl(_ label: String) -> Bool {
      let control = application.buttons[label].firstMatch
      guard control.waitForExistence(timeout: 8), control.isHittable else {
        XCTFail("The platform-reactivity control \(label) was not physically hittable.")
        return false
      }
      control.tap()
      return true
    }

    func requireWindow(_ orientation: String, portrait: Bool) -> Bool {
      let snapshot = application.staticTexts.matching(
        NSPredicate(format: "label BEGINSWITH %@", "Window \(orientation) ")
      ).firstMatch
      guard snapshot.waitForExistence(timeout: 10) else {
        XCTFail("Solid did not publish the \(orientation) iPhone window snapshot.")
        return false
      }
      let fields = snapshot.label.split(separator: " ")
      guard fields.count == 7 else {
        XCTFail("The Solid window snapshot had an invalid shape: \(snapshot.label)")
        return false
      }
      let dimensions = fields[2].split(separator: "x")
      guard dimensions.count == 2,
        let width = Double(dimensions[0]),
        let height = Double(dimensions[1]),
        let scale = Double(fields[4]),
        let fontScale = Double(fields[6])
      else {
        XCTFail("The Solid window snapshot was not finite: \(snapshot.label)")
        return false
      }
      XCTAssertGreaterThan(width, 0)
      XCTAssertGreaterThan(height, 0)
      XCTAssertGreaterThan(scale, 0)
      XCTAssertGreaterThan(fontScale, 0)
      XCTAssertEqual(portrait, height > width)
      return true
    }

    func requireAppearance(_ appearance: String) -> Bool {
      let output = application.staticTexts["Appearance \(appearance)"].firstMatch
      guard output.waitForExistence(timeout: 10) else {
        XCTFail("Solid did not publish the iPhone \(appearance) appearance.")
        return false
      }
      return true
    }

    device.orientation = .portrait
    application.terminate()
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The platform-reactivity application did not launch on the iPhone.")
      return
    }

    let ready = application.staticTexts["Solid Native platform reactivity ready"].firstMatch
    guard ready.waitForExistence(timeout: 10) else {
      XCTFail("The Solid Native platform-reactivity proof did not mount on the iPhone.")
      return
    }
    guard requireWindow("portrait", portrait: true) else { return }

    let initialAppearance: String
    if application.staticTexts["Appearance dark"].exists {
      initialAppearance = "dark"
    } else if application.staticTexts["Appearance light"].exists {
      initialAppearance = "light"
    } else {
      XCTFail("Solid did not expose the iPhone's initial system appearance.")
      return
    }

    device.orientation = .landscapeLeft
    XCTAssertEqual(device.orientation, .landscapeLeft)
    guard tapControl("Commit native platform change") else { return }
    guard requireWindow("landscape", portrait: false) else { return }

    device.orientation = .portrait
    XCTAssertEqual(device.orientation, .portrait)
    guard tapControl("Commit native platform change") else { return }
    guard requireWindow("portrait", portrait: true) else { return }

    let alternateAppearance = initialAppearance == "dark" ? "light" : "dark"
    device.appearance = alternateAppearance == "dark" ? .dark : .light
    guard tapControl("Commit native platform change") else { return }
    guard requireAppearance(alternateAppearance) else { return }

    device.appearance = originalAppearance
    guard tapControl("Commit native platform change") else { return }
    guard requireAppearance(initialAppearance) else { return }

    guard tapControl("Dispose Solid Native platform reactivity proof") else { return }
    guard waitForPredicate(
      NSPredicate(format: "exists == false"),
      evaluatedWith: ready,
      timeout: 10,
      failureMessage: "The iPhone platform-reactivity tree survived terminal teardown."
    ) else { return }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testSafeAreaDeliveryAndRotationOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let device = XCUIDevice.shared
    let originalOrientation = device.orientation
    let restorationOrientation: UIDeviceOrientation
    switch originalOrientation {
    case .portrait, .portraitUpsideDown, .landscapeLeft, .landscapeRight:
      restorationOrientation = originalOrientation
    default:
      restorationOrientation = .portrait
    }
    defer { device.orientation = restorationOrientation }

    func tapControl(_ label: String) -> Bool {
      let control = application.buttons[label].firstMatch
      guard control.waitForExistence(timeout: 8), control.isHittable else {
        XCTFail("The safe-area control \(label) was not physically hittable.")
        return false
      }
      control.tap()
      return true
    }

    func requireMetrics(
      portrait: Bool,
      differentFrom previousLabel: String? = nil
    ) -> (
      label: String,
      top: CGFloat,
      right: CGFloat,
      bottom: CGFloat,
      left: CGFloat,
      width: CGFloat,
      height: CGFloat
    )? {
      let output = application.staticTexts["solid-native-safe-area-metrics"].firstMatch
      guard output.waitForExistence(timeout: 10) else {
        XCTFail("The Solid safe-area metrics did not mount on the iPhone.")
        return nil
      }
      if let previousLabel {
        guard waitForPredicate(
          NSPredicate(format: "label != %@", previousLabel),
          evaluatedWith: output,
          timeout: 10,
          failureMessage: "The iPhone safe-area metrics did not change after rotation."
        ) else { return nil }
      }
      let fields = output.label.split(separator: " ")
      guard fields.count == 4, fields[0] == "Insets", fields[2] == "frame" else {
        XCTFail("The Solid safe-area snapshot had an invalid shape: \(output.label)")
        return nil
      }
      let insets = fields[1].split(separator: "/")
      let frame = fields[3].split(separator: "x")
      guard insets.count == 4, frame.count == 2,
        let top = Double(insets[0]),
        let right = Double(insets[1]),
        let bottom = Double(insets[2]),
        let left = Double(insets[3]),
        let width = Double(frame[0]),
        let height = Double(frame[1])
      else {
        XCTFail("The Solid safe-area snapshot was not finite: \(output.label)")
        return nil
      }
      for value in [top, right, bottom, left] {
        XCTAssertGreaterThanOrEqual(value, 0)
      }
      XCTAssertGreaterThan(width, 0)
      XCTAssertGreaterThan(height, 0)
      XCTAssertEqual(portrait, height > width)
      return (
        output.label,
        CGFloat(top),
        CGFloat(right),
        CGFloat(bottom),
        CGFloat(left),
        CGFloat(width),
        CGFloat(height)
      )
    }

    device.orientation = .portrait
    application.terminate()
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The safe-area application did not launch on the iPhone.")
      return
    }

    let ready = application.staticTexts["Solid Native safe area ready"].firstMatch
    guard ready.waitForExistence(timeout: 10) else {
      XCTFail("The Solid Native safe-area proof did not become ready on the iPhone.")
      return
    }
    guard let portraitMetrics = requireMetrics(portrait: true) else { return }
    XCTAssertGreaterThan(portraitMetrics.top, 0)
    XCTAssertGreaterThan(portraitMetrics.bottom, 0)

    let topAnchor = application.otherElements["Solid Native safe area top anchor"].firstMatch
    let bottomAnchor = application.otherElements[
      "Solid Native safe area bottom anchor"
    ].firstMatch
    guard topAnchor.waitForExistence(timeout: 5), bottomAnchor.waitForExistence(timeout: 5) else {
      XCTFail("The physical iPhone safe-area anchors did not mount.")
      return
    }
    XCTAssertEqual(
      topAnchor.frame.minY - application.frame.minY,
      portraitMetrics.top,
      accuracy: 3
    )
    XCTAssertEqual(
      application.frame.maxY - bottomAnchor.frame.maxY,
      portraitMetrics.bottom,
      accuracy: 3
    )

    device.orientation = .landscapeLeft
    XCTAssertEqual(device.orientation, .landscapeLeft)
    guard tapControl("Commit native safe-area change"),
      let landscapeMetrics = requireMetrics(
        portrait: false,
        differentFrom: portraitMetrics.label
      )
    else { return }
    XCTAssertGreaterThan(landscapeMetrics.left + landscapeMetrics.right, 0)
    XCTAssertTrue(topAnchor.isHittable)
    XCTAssertTrue(bottomAnchor.isHittable)

    device.orientation = .portrait
    XCTAssertEqual(device.orientation, .portrait)
    guard tapControl("Commit native safe-area change"),
      let restoredMetrics = requireMetrics(
        portrait: true,
        differentFrom: landscapeMetrics.label
      )
    else { return }
    XCTAssertGreaterThan(restoredMetrics.top, 0)
    XCTAssertGreaterThan(restoredMetrics.bottom, 0)

    guard tapControl("Dispose Solid Native safe area proof") else { return }
    guard waitForPredicate(
      NSPredicate(format: "exists == false"),
      evaluatedWith: ready,
      timeout: 10,
      failureMessage: "The iPhone safe-area tree survived terminal teardown."
    ) else { return }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testStatusBarOwnerStackOnPhysicalDevice() throws {
    let application = XCUIApplication()

    func tapControl(_ label: String) -> Bool {
      let control = application.buttons[label].firstMatch
      guard control.waitForExistence(timeout: 8), control.isHittable else {
        XCTFail("The status-bar control \(label) was not physically hittable.")
        return false
      }
      control.tap()
      return true
    }

    func waitForState(_ label: String) -> Bool {
      let state = application.staticTexts["solid-native-status-bar-state"].firstMatch
      guard state.waitForExistence(timeout: 8) else {
        XCTFail("The Solid status-bar state did not mount on the iPhone.")
        return false
      }
      return waitForPredicate(
        NSPredicate(format: "label == %@", label),
        evaluatedWith: state,
        timeout: 8,
        failureMessage: "The Solid status-bar owner state did not become \(label)."
      )
    }

    func statusBarPixelCounts() -> (dark: Int, light: Int)? {
      guard let source = application.screenshot().image.cgImage else {
        XCTFail("The physical iPhone screenshot had no pixel buffer.")
        return nil
      }
      let width = source.width
      let height = source.height
      let applicationWidth = application.frame.width
      guard width > 0, height > 0, applicationWidth > 0 else {
        XCTFail("The physical iPhone status-bar screenshot was empty.")
        return nil
      }
      var pixels = [UInt8](repeating: 0, count: width * height * 4)
      let rendered = pixels.withUnsafeMutableBytes { buffer -> Bool in
        guard let context = CGContext(
          data: buffer.baseAddress,
          width: width,
          height: height,
          bitsPerComponent: 8,
          bytesPerRow: width * 4,
          space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue
            | CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return false }
        context.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))
        return true
      }
      guard rendered else {
        XCTFail("The physical iPhone status-bar screenshot could not be normalized.")
        return nil
      }

      let leftLimit = Int(Double(width) * 0.36)
      let rightLimit = Int(Double(width) * 0.64)
      let scale = CGFloat(width) / applicationWidth
      let statusBarHeight = min(height, Int((64 * scale).rounded(.up)))
      var dark = 0
      var light = 0
      for y in 0..<statusBarHeight {
        for x in 0..<width where x < leftLimit || x >= rightLimit {
          let offset = (y * width + x) * 4
          let red = Int(pixels[offset])
          let green = Int(pixels[offset + 1])
          let blue = Int(pixels[offset + 2])
          let alpha = Int(pixels[offset + 3])
          let brightness = red + green + blue
          if alpha >= 240, brightness < 240 {
            dark += 1
          } else if alpha >= 240, brightness > 600 {
            light += 1
          }
        }
      }
      return (dark, light)
    }

    func attachStatusBar(name: String) {
      let attachment = XCTAttachment(screenshot: application.screenshot())
      attachment.name = name
      attachment.lifetime = .keepAlways
      add(attachment)
    }

    func waitForStatusBarPixels(
      description: String,
      matching predicate: ((dark: Int, light: Int)) -> Bool
    ) -> (dark: Int, light: Int)? {
      let deadline = Date().addingTimeInterval(10)
      var lastCounts: (dark: Int, light: Int)?
      repeat {
        if let counts = statusBarPixelCounts() {
          lastCounts = counts
          if predicate(counts) { return counts }
        }
        Thread.sleep(forTimeInterval: 0.15)
      } while Date() < deadline
      XCTFail(
        "The physical iPhone status bar did not become \(description); last dark/light counts were \(String(describing: lastCounts))."
      )
      return nil
    }

    application.terminate()
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The status-bar application did not launch on the iPhone.")
      return
    }

    let ready = application.staticTexts["Solid Native status bar ready"].firstMatch
    guard ready.waitForExistence(timeout: 10),
      waitForState("Status bar parent dark visible"),
      let initialPixels = statusBarPixelCounts()
    else { return }
    XCTAssertGreaterThan(initialPixels.dark, initialPixels.light + 50)
    attachStatusBar(name: "Solid Native dark status-bar content")

    guard tapControl("Mount light status bar owner"),
      waitForState("Status bar child light visible"),
      let lightPixels = waitForStatusBarPixels(
        description: "light content",
        matching: { counts in
          counts.light > initialPixels.light + 50
            && counts.dark * 2 < initialPixels.dark
        }
      )
    else { return }
    attachStatusBar(name: "Solid Native light status-bar content")

    guard tapControl("Hide status bar from child owner"),
      waitForState("Status bar child light hidden"),
      let hiddenPixels = waitForStatusBarPixels(
        description: "hidden",
        matching: { counts in
          counts.dark * 2 < initialPixels.dark
            && counts.light * 2 < lightPixels.light
        }
      )
    else { return }
    attachStatusBar(name: "Solid Native hidden status bar")

    guard tapControl("Dispose child status bar owner"),
      waitForState("Status bar parent dark visible"),
      let restoredPixels = waitForStatusBarPixels(
        description: "restored dark content",
        matching: { counts in
          counts.dark > lightPixels.dark * 2
            && counts.dark > hiddenPixels.dark + 50
        }
      )
    else { return }
    XCTAssertGreaterThan(restoredPixels.dark, restoredPixels.light + 50)
    attachStatusBar(name: "Solid Native restored dark status-bar content")

    guard tapControl("Dispose Solid Native status bar proof") else { return }
    guard waitForPredicate(
      NSPredicate(format: "exists == false"),
      evaluatedWith: ready,
      timeout: 10,
      failureMessage: "The iPhone status-bar tree survived terminal teardown."
    ) else { return }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testOutboundApplicationURLAndSettingsHandoffsOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
    let removed = NSPredicate(format: "exists == false")

    func tapControl(_ label: String) -> Bool {
      let control = application.buttons[label].firstMatch
      guard control.waitForExistence(timeout: 8), control.isHittable else {
        XCTFail("The Linking control \(label) was not physically hittable.")
        return false
      }
      control.tap()
      return true
    }

    application.terminate()
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The direct-Linking application did not launch on the iPhone.")
      return
    }

    let ready = application.staticTexts["Solid Native linking ready"].firstMatch
    guard ready.waitForExistence(timeout: 10) else {
      XCTFail("The direct-Linking Solid owner did not mount on the iPhone.")
      return
    }
    XCTAssertTrue(
      application.staticTexts["Native URL delivery: waiting"]
        .waitForExistence(timeout: 5)
    )

    guard tapControl("Open registered application URL") else { return }
    XCTAssertTrue(
      application.wait(for: .runningForeground, timeout: 8),
      "The registered application URL did not return to the existing iPhone app."
    )
    guard tapControl("Commit native URL delivery") else { return }
    guard application.staticTexts["Native URL delivery: received"]
      .waitForExistence(timeout: 10)
    else {
      XCTFail("The exact registered URL did not reach the Solid-owned accessor.")
      return
    }

    guard tapControl("Open application settings") else { return }
    guard settings.wait(for: .runningForeground, timeout: 10) else {
      XCTFail("The direct native Linking service did not open iOS Settings.")
      return
    }
    let applicationLabel = settings.descendants(matching: .any).matching(
      NSPredicate(format: "label == %@", "Solid Native E2E")
    ).firstMatch
    guard applicationLabel.waitForExistence(timeout: 8) else {
      XCTFail("iOS Settings did not open the Solid Native app-specific page.")
      return
    }

    application.activate()
    guard application.wait(for: .runningForeground, timeout: 10) else {
      XCTFail("The original Solid Native process did not return from Settings.")
      return
    }
    XCTAssertTrue(
      ready.waitForExistence(timeout: 5),
      "The retained Linking owner disappeared after the Settings handoff."
    )
    XCTAssertTrue(
      application.staticTexts["Native URL delivery: received"]
        .waitForExistence(timeout: 5),
      "The live URL state was lost across the Settings handoff."
    )

    guard tapControl("Dispose Solid Native linking proof") else { return }
    guard waitForPredicate(
      removed,
      evaluatedWith: ready,
      timeout: 10,
      failureMessage: "The direct-Linking tree survived terminal owner teardown."
    ) else { return }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testNativeShareSheetCompletionDismissalAndTeardownOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let removed = NSPredicate(format: "exists == false")

    func tapControl(_ label: String) -> Bool {
      let control = application.buttons[label].firstMatch
      guard control.waitForExistence(timeout: 8), control.isHittable else {
        XCTFail("The sharing control \(label) was not physically hittable.")
        return false
      }
      control.tap()
      return true
    }

    func requireSharePopover() -> XCUIElement? {
      let sharePopover = application.popovers.firstMatch
      guard sharePopover.waitForExistence(timeout: 10) else {
        XCTFail("The direct native sharing service did not present a UIKit activity popover.")
        return nil
      }
      XCTAssertFalse(sharePopover.frame.isEmpty)
      return sharePopover
    }

    func selectCopy(in sharePopover: XCUIElement) -> Bool {
      let copy = sharePopover.cells["Copy"].firstMatch
      let deadline = Date().addingTimeInterval(12)
      repeat {
        if copy.exists, copy.isHittable {
          copy.tap()
          return true
        }
        sharePopover.swipeUp()
      } while Date() < deadline
      XCTFail("The physical iPhone share sheet did not expose its Copy activity.")
      return false
    }

    application.terminate()
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The direct-sharing application did not launch on the iPhone.")
      return
    }

    let ready = application.staticTexts["Solid Native sharing ready"].firstMatch
    guard ready.waitForExistence(timeout: 10) else {
      XCTFail("The direct-sharing Solid owner did not mount on the iPhone.")
      return
    }

    guard tapControl("Share message and URL"),
      let combinedPopover = requireSharePopover(),
      selectCopy(in: combinedPopover)
    else { return }
    guard application.staticTexts["Combined share result: completed"]
      .waitForExistence(timeout: 10)
    else {
      XCTFail("The UIKit Copy activity did not produce a completed Solid result.")
      return
    }

    guard tapControl("Share URL only"), let urlPopover = requireSharePopover() else {
      return
    }
    let dismissRegion = application.otherElements["PopoverDismissRegion"].firstMatch
    if dismissRegion.waitForExistence(timeout: 2), dismissRegion.isHittable {
      dismissRegion.tap()
    } else {
      urlPopover.swipeDown()
    }
    guard application.staticTexts["URL-only share result: dismissed"]
      .waitForExistence(timeout: 10)
    else {
      XCTFail("Dismissing the UIKit activity sheet did not reach Solid.")
      return
    }

    XCTAssertTrue(
      ready.exists,
      "The sharing owner disappeared before explicit terminal teardown."
    )
    guard tapControl("Dispose Solid Native sharing proof") else { return }
    guard waitForPredicate(
      removed,
      evaluatedWith: ready,
      timeout: 10,
      failureMessage: "The direct-sharing tree survived terminal owner teardown."
    ) else { return }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testNativeNotificationDeliveryCancellationAndTeardownOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let removed = NSPredicate(format: "exists == false")

    func tapControl(_ label: String) -> Bool {
      let control = application.buttons[label].firstMatch
      guard control.waitForExistence(timeout: 8), control.isHittable else {
        XCTFail("The notification control \(label) was not physically hittable.")
        return false
      }
      control.tap()
      return true
    }

    application.terminate()
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The wrapper-free notification application did not launch on the iPhone.")
      return
    }

    let ready = application.staticTexts["Solid Native notifications ready"].firstMatch
    guard ready.waitForExistence(timeout: 10) else {
      XCTFail("The notification Solid owner did not mount on the iPhone.")
      return
    }

    guard tapControl("Authorize local notifications") else { return }
    // iOS 26 exposes this first-install permission sheet through SpringBoard,
    // but XCTest's generic interruption monitor cannot construct its alert
    // query. Addressing the exact system-owned Allow action remains fully
    // automated and avoids accidentally selecting "Don't Allow".
    let allow = springboard.buttons["Allow"].firstMatch
    if allow.waitForExistence(timeout: 8) {
      guard allow.isHittable else {
        XCTFail("The SpringBoard notification Allow action was not physically hittable.")
        return
      }
      allow.tap()
    }
    guard application.staticTexts["Native notification permission authorized"]
      .waitForExistence(timeout: 10)
    else {
      XCTFail("The wrapper-free Notify Kit permission result did not reach Solid.")
      return
    }
    // Keep authorization and display as distinct user-visible operations. On
    // first install the request promise may resolve while UIKit is still
    // returning the application from Inactive to Active; displaying in that
    // transition makes Notify Kit route a real delivery onto its background
    // channel. The second physical tap establishes an active foreground before
    // we require the foreground event.
    guard tapControl("Display local native notification") else { return }
    guard application.staticTexts["Native notification delivery observed"]
      .waitForExistence(timeout: 15)
    else {
      XCTFail("The wrapper-free Notify Kit foreground event did not reach Solid.")
      return
    }

    XCTAssertTrue(
      ready.exists,
      "The notification owner disappeared after native delivery."
    )
    guard tapControl("Cancel local native notification") else { return }
    guard application.staticTexts["Native notification cancelled"]
      .waitForExistence(timeout: 10)
    else {
      XCTFail("The native notification did not disappear through Notify Kit cancellation.")
      return
    }

    XCTAssertTrue(
      ready.exists,
      "The notification owner disappeared before explicit terminal teardown."
    )
    guard tapControl("Dispose Solid Native notification proof") else { return }
    guard waitForPredicate(
      removed,
      evaluatedWith: ready,
      timeout: 10,
      failureMessage: "The notification tree survived terminal owner teardown."
    ) else { return }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testNativeClipboardBoundaryCausalityAndTeardownOnPhysicalDevice() throws {
    let application = XCUIApplication()
    // The source bundle is built and installed separately by
    // ios-clipboard-test.sh. XCTest's own process cannot access the general
    // pasteboard on a physical iPhone, so every independent observation must
    // happen in this second signed application.
    let source = XCUIApplication(bundleIdentifier: "dev.solidnative.clipboardsource")
    source.launchArguments = ["--solid-native-clipboard-source"]
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let removed = NSPredicate(format: "exists == false")
    var sourceCaptureAttempted = false
    var sourceRestored = false

    func tapControl(_ target: XCUIApplication, _ label: String) -> Bool {
      let control = target.buttons[label].firstMatch
      guard control.waitForExistence(timeout: 8), control.isHittable else {
        XCTFail("The clipboard control \(label) was not physically hittable.")
        return false
      }
      control.tap()
      return true
    }

    func waitForStatus(_ target: XCUIApplication, _ label: String) -> Bool {
      guard target.staticTexts[label].firstMatch.waitForExistence(timeout: 12) else {
        XCTFail("The clipboard status \(label) did not appear.")
        return false
      }
      return true
    }

    func allowCrossApplicationPasteIfNeeded() -> Bool {
      for label in ["Allow Paste", "Allow"] {
        let control = springboard.buttons[label].firstMatch
        if control.waitForExistence(timeout: label == "Allow Paste" ? 5 : 1) {
          guard control.isHittable else {
            XCTFail("The SpringBoard \(label) paste action was not physically hittable.")
            return false
          }
          control.tap()
          return true
        }
      }
      return true
    }

    func restoreOriginalClipboardIfNeeded() {
      guard sourceCaptureAttempted, !sourceRestored else { return }
      if source.state == .notRunning {
        source.launch()
      } else {
        source.activate()
      }
      guard source.wait(for: .runningForeground, timeout: 8) else {
        XCTFail("The native source app could not return to restore the original clipboard.")
        return
      }
      let restore = source.buttons["Restore original clipboard"].firstMatch
      guard restore.waitForExistence(timeout: 8), restore.isHittable else {
        XCTFail("The original clipboard restoration control was not hittable.")
        return
      }
      restore.tap()
      guard source.staticTexts["Original clipboard restored"].firstMatch
        .waitForExistence(timeout: 12)
      else {
        XCTFail("The native source app did not restore the original clipboard archive.")
        return
      }
      sourceRestored = true
    }

    defer {
      restoreOriginalClipboardIfNeeded()
    }

    source.terminate()
    source.launch()
    guard source.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The signed native clipboard source app did not launch on the iPhone.")
      return
    }
    guard waitForStatus(source, "Clipboard source ready") else { return }
    sourceCaptureAttempted = true
    guard tapControl(source, "Capture and seed external clipboard proof") else { return }
    guard allowCrossApplicationPasteIfNeeded() else { return }
    guard waitForStatus(source, "External clipboard proof seeded") else { return }

    application.terminate()
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The direct clipboard application did not launch on the iPhone.")
      return
    }

    let ready = application.staticTexts["Solid Native clipboard ready"].firstMatch
    guard ready.waitForExistence(timeout: 10) else {
      XCTFail("The clipboard Solid owner did not mount on the iPhone.")
      return
    }

    guard tapControl(application, "Read Solid Native clipboard proof") else { return }
    guard allowCrossApplicationPasteIfNeeded() else { return }
    guard waitForStatus(application, "External clipboard proof read") else { return }

    XCTAssertTrue(
      ready.exists,
      "The clipboard owner disappeared after the private read settlement."
    )

    guard tapControl(application, "Write Solid Native clipboard proof") else { return }
    guard waitForStatus(application, "Clipboard proof written") else { return }

    source.activate()
    guard source.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The native source app could not verify the app-to-iOS write.")
      return
    }
    guard tapControl(source, "Verify Solid Native clipboard write proof") else { return }
    guard allowCrossApplicationPasteIfNeeded() else { return }
    guard waitForStatus(source, "Solid Native clipboard write verified") else { return }

    application.activate()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The clipboard app could not return for the clear operation.")
      return
    }
    guard tapControl(application, "Clear native clipboard") else { return }
    guard waitForStatus(application, "Clipboard cleared") else { return }

    source.activate()
    guard source.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The native source app could not verify the clipboard clear.")
      return
    }
    guard tapControl(source, "Verify native clipboard cleared") else { return }
    guard allowCrossApplicationPasteIfNeeded() else { return }
    guard waitForStatus(source, "Native clipboard clear verified") else { return }
    restoreOriginalClipboardIfNeeded()
    guard sourceRestored else { return }

    application.activate()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The clipboard app could not return for terminal teardown.")
      return
    }
    guard tapControl(application, "Dispose Solid Native clipboard proof") else { return }
    guard waitForPredicate(
      removed,
      evaluatedWith: ready,
      timeout: 10,
      failureMessage: "The clipboard tree survived terminal owner teardown."
    ) else { return }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testNativeLocalizationStartupSnapshotsAndPhysicalLayoutOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let removed = NSPredicate(format: "exists == false")

    func verifyColdStart(
      languageTag: String,
      localeIdentifier: String,
      expectedDirection: String,
      leadingShouldBeLeft: Bool
    ) -> Bool {
      application.terminate()
      application.launchArguments = [
        "-AppleLanguages", "(\(languageTag))",
        "-AppleLocale", localeIdentifier,
      ]
      application.launch()
      guard application.wait(for: .runningForeground, timeout: 8) else {
        XCTFail("The \(languageTag) localization application did not cold-start on the iPhone.")
        return false
      }

      let ready = application.staticTexts["Solid Native localization ready"].firstMatch
      guard ready.waitForExistence(timeout: 10) else {
        XCTFail("The \(languageTag) localization snapshot did not mount.")
        return false
      }
      guard application.staticTexts["Locale \(languageTag)"].firstMatch
        .waitForExistence(timeout: 5)
      else {
        XCTFail("Hermes Intl did not expose the expected \(languageTag) startup locale.")
        return false
      }
      guard application.staticTexts["Direction \(expectedDirection)"].firstMatch
        .waitForExistence(timeout: 5)
      else {
        XCTFail("The native I18nManager snapshot did not expose \(expectedDirection).")
        return false
      }
      guard application.staticTexts["RTL style swapping enabled"].firstMatch
        .waitForExistence(timeout: 5)
      else {
        XCTFail("The native I18nManager style-swap policy was not enabled.")
        return false
      }

      let leading = application.staticTexts["Localization leading marker"].firstMatch
      let trailing = application.staticTexts["Localization trailing marker"].firstMatch
      guard leading.waitForExistence(timeout: 5), trailing.waitForExistence(timeout: 5) else {
        XCTFail("The physical localization markers did not mount.")
        return false
      }
      XCTAssertFalse(leading.frame.isEmpty, "The leading Fabric marker had empty bounds.")
      XCTAssertFalse(trailing.frame.isEmpty, "The trailing Fabric marker had empty bounds.")
      if leadingShouldBeLeft {
        XCTAssertLessThan(
          leading.frame.midX,
          trailing.frame.midX,
          "The LTR Fabric row did not place its leading child on the left."
        )
      } else {
        XCTAssertGreaterThan(
          leading.frame.midX,
          trailing.frame.midX,
          "The RTL Fabric row did not mirror its leading and trailing children."
        )
      }

      let dispose = application.buttons["Dispose Solid Native localization proof"].firstMatch
      guard dispose.waitForExistence(timeout: 5), dispose.isHittable else {
        XCTFail("The \(languageTag) localization teardown control was not hittable.")
        return false
      }
      dispose.tap()
      guard waitForPredicate(
        removed,
        evaluatedWith: ready,
        timeout: 10,
        failureMessage: "The \(languageTag) localization tree survived terminal teardown."
      ) else { return false }
      XCTAssertEqual(application.state, .runningForeground)
      return true
    }

    guard verifyColdStart(
      languageTag: "en-US",
      localeIdentifier: "en_US",
      expectedDirection: "ltr",
      leadingShouldBeLeft: true
    ) else { return }
    guard verifyColdStart(
      languageTag: "ar-SA",
      localeIdentifier: "ar_SA",
      expectedDirection: "rtl",
      leadingShouldBeLeft: false
    ) else { return }
  }

  func testNativeAlertButtonCancellationAndTeardownOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let removed = NSPredicate(format: "exists == false")

    func tapControl(_ label: String) -> Bool {
      let control = application.buttons[label].firstMatch
      guard control.waitForExistence(timeout: 8), control.isHittable else {
        XCTFail("The alert control \(label) was not physically hittable.")
        return false
      }
      control.tap()
      return true
    }

    application.terminate()
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The direct-alert application did not launch on the iPhone.")
      return
    }

    let ready = application.staticTexts["Solid Native alert ready"].firstMatch
    guard ready.waitForExistence(timeout: 10) else {
      XCTFail("The direct-alert Solid owner did not mount on the iPhone.")
      return
    }

    guard tapControl("Show destructive native alert") else { return }
    let destructiveAlert = application.alerts["Delete local draft?"].firstMatch
    guard destructiveAlert.waitForExistence(timeout: 10) else {
      XCTFail("The direct native alert service did not present its UIKit alert.")
      return
    }
    XCTAssertTrue(destructiveAlert.staticTexts["This cannot be undone."].exists)
    XCTAssertTrue(destructiveAlert.buttons["Cancel"].exists)
    let delete = destructiveAlert.buttons["Delete"].firstMatch
    guard delete.waitForExistence(timeout: 5), delete.isHittable else {
      XCTFail("The destructive UIKit alert did not expose its Delete action.")
      return
    }
    delete.tap()
    guard application.staticTexts["Alert result: delete"]
      .waitForExistence(timeout: 10)
    else {
      XCTFail("The destructive UIKit button identity did not reach Solid.")
      return
    }

    guard tapControl("Show cancellable native alert") else { return }
    let cancellableAlert = application.alerts["Dismiss this alert"].firstMatch
    guard cancellableAlert.waitForExistence(timeout: 10) else {
      XCTFail("The direct native alert service did not present its cancel alert.")
      return
    }
    XCTAssertTrue(
      cancellableAlert.staticTexts["Select Cancel to settle through UIKit."].exists
    )
    let cancel = cancellableAlert.buttons["Cancel"].firstMatch
    guard cancel.waitForExistence(timeout: 5), cancel.isHittable else {
      XCTFail("The UIKit alert did not expose its cancel-styled action.")
      return
    }
    cancel.tap()
    guard application.staticTexts["Alert result: cancel"]
      .waitForExistence(timeout: 10)
    else {
      XCTFail("The cancel-styled UIKit button identity did not reach Solid.")
      return
    }

    XCTAssertTrue(
      ready.exists,
      "The alert owner disappeared before explicit terminal teardown."
    )
    guard tapControl("Dispose Solid Native alert proof") else { return }
    guard waitForPredicate(
      removed,
      evaluatedWith: ready,
      timeout: 10,
      failureMessage: "The direct-alert tree survived terminal owner teardown."
    ) else { return }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testSoftwareKeyboardOnPhysicalDevice() throws {
    let application = XCUIApplication()
    application.launch()

    let title = application.staticTexts["solid-native-keyboard-title"]
    guard title.waitForExistence(timeout: 10) else {
      XCTFail("The Solid Native keyboard proof did not mount.")
      return
    }
    XCTAssertEqual(title.label, "Solid Native keyboard proof")

    let status = application.staticTexts["solid-native-keyboard-status"]
    guard status.waitForExistence(timeout: 5) else {
      XCTFail("The Solid Native keyboard state did not mount.")
      return
    }
    XCTAssertEqual(status.label, "Solid Native keyboard ready")

    let textInput = application.textFields["solid-native-keyboard-input"]
    guard textInput.waitForExistence(timeout: 5), textInput.isHittable else {
      XCTFail("The native TextInput was not hittable for the keyboard proof.")
      return
    }
    XCTAssertEqual(textInput.label, "Solid Native keyboard proof input")
    textInput.tap()

    let softwareKeyboard = application.keyboards.firstMatch
    guard softwareKeyboard.waitForExistence(timeout: 5) else {
      XCTFail("The iOS software keyboard did not appear after native focus.")
      return
    }
    let visible = NSPredicate(
      format: "label == %@", "Solid Native keyboard visible with positive metrics"
    )
    guard waitForPredicate(
      visible,
      evaluatedWith: status,
      timeout: 5,
      failureMessage: "Solid did not expose positive normalized keyboard metrics."
    ) else {
      return
    }

    textInput.typeText("SolidNative42")
    textInput.typeText("\n")
    let hidden = NSPredicate(format: "exists == false")
    guard waitForPredicate(
      hidden,
      evaluatedWith: softwareKeyboard,
      timeout: 5,
      failureMessage: "The iOS software keyboard did not hide after submit and blur."
    ) else {
      return
    }
    let succeeded = NSPredicate(
      format: "label == %@",
      "Solid Native keyboard show, submit, blur, and hide observed"
    )
    guard waitForPredicate(
      succeeded,
      evaluatedWith: status,
      timeout: 5,
      failureMessage: "Solid did not observe the complete keyboard lifecycle."
    ) else {
      return
    }

    let dispose = application.buttons["Dispose Solid Native keyboard proof"]
    guard dispose.waitForExistence(timeout: 5), dispose.isHittable else {
      XCTFail("The keyboard teardown control was not hittable.")
      return
    }
    dispose.tap()
    guard waitForPredicate(
      hidden,
      evaluatedWith: title,
      timeout: 5,
      failureMessage: "The keyboard proof survived terminal owner teardown."
    ) else {
      return
    }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testReactControlUpdateOnPhysicalDevice() throws {
    let application = XCUIApplication()
    application.launch()

    let title = application.staticTexts["react-control-title"]
    guard title.waitForExistence(timeout: 10) else {
      XCTFail("The React Native control title did not mount.")
      return
    }
    XCTAssertEqual(title.label, "React Native 0.87 control")

    let status = application.staticTexts["react-control-status"]
    guard status.waitForExistence(timeout: 5) else {
      XCTFail("The React Native control status did not mount.")
      return
    }
    XCTAssertEqual(status.label, "React control count 0")

    let generatedView = application.otherElements["react-control-generated-view"]
    XCTAssertTrue(
      generatedView.waitForExistence(timeout: 5),
      "The React Native control generated component did not mount."
    )

    let button = application.buttons["react-control-button"]
    guard button.waitForExistence(timeout: 5), button.isHittable else {
      XCTFail("The React Native control update button was not hittable.")
      return
    }
    button.tap()

    let updatedStatus = application.staticTexts["react-control-status"]
    let updated = NSPredicate(format: "label == %@", "React control count 1")
    guard waitForPredicate(
      updated,
      evaluatedWith: updatedStatus,
      timeout: 5,
      failureMessage: "The React Native control did not expose its updated state."
    ) else {
      return
    }
  }

  func testNativeUIWorkletOnPhysicalDevice() throws {
    let application = XCUIApplication()
    application.launch()

    let ready = application.staticTexts[
      "Native UI worklet ready for installation"
    ]
    guard ready.waitForExistence(timeout: 10) else {
      XCTFail("The native UI worklet proof did not become ready.")
      return
    }

    let target = application.otherElements["Solid Native UI worklet target"]
    guard target.waitForExistence(timeout: 5) else {
      XCTFail("The native UI worklet target did not mount.")
      return
    }
    let initialFrame = target.frame
    XCTAssertGreaterThan(initialFrame.width, 100)
    XCTAssertGreaterThan(initialFrame.height, 60)

    let install = application.buttons["Install native UI worklet"]
    guard install.waitForExistence(timeout: 5), install.isHittable else {
      XCTFail("The native UI worklet install control was not hittable.")
      return
    }
    install.tap()
    XCTAssertTrue(
      application.staticTexts["Native UI worklet initial frame applied"]
        .waitForExistence(timeout: 8),
      "The initial CADisplayLink frame was not applied."
    )

    let update = application.buttons["Update native UI worklet"]
    guard update.waitForExistence(timeout: 5), update.isHittable else {
      XCTFail("The native UI worklet update control was not hittable.")
      return
    }
    update.tap()
    guard application.staticTexts["Native UI worklet update frame applied"]
      .waitForExistence(timeout: 8)
    else {
      XCTFail("The updated CADisplayLink frame was not applied.")
      return
    }

    // The updated status is gated by a main-thread readback of the mounted
    // UIView's alpha and affine transform. XCUIElement.frame intentionally
    // reports the pre-transform accessibility layout rectangle on iOS 26.
    XCTAssertTrue(target.exists)

    let timing = application.buttons["Animate native UI worklet"]
    guard timing.waitForExistence(timeout: 5), timing.isHittable else {
      XCTFail("The native UI worklet timing control was not hittable.")
      return
    }
    timing.tap()
    guard application.staticTexts["Native UI worklet timing completed"]
      .waitForExistence(timeout: 8)
    else {
      XCTFail("The interrupted CADisplayLink timing did not complete.")
      return
    }
    XCTAssertTrue(target.exists)

    let stability = application.buttons["Measure native UI worklet stability"]
    guard stability.waitForExistence(timeout: 5), stability.isHittable else {
      XCTFail("The native UI worklet stability control was not hittable.")
      return
    }
    stability.tap()
    guard application.staticTexts["Native UI worklet stability completed"]
      .waitForExistence(timeout: 12)
    else {
      XCTFail("The sustained CADisplayLink timing was not stable.")
      return
    }
    XCTAssertTrue(target.exists)

    let keyframes = application.buttons["Keyframe native UI worklet"]
    guard keyframes.waitForExistence(timeout: 5), keyframes.isHittable else {
      XCTFail("The native UI worklet keyframe control was not hittable.")
      return
    }
    keyframes.tap()
    guard application.staticTexts["Native UI worklet keyframes completed"]
      .waitForExistence(timeout: 8)
    else {
      XCTFail("The native CADisplayLink keyframe sequence did not complete.")
      return
    }
    XCTAssertTrue(target.exists)

    let spring = application.buttons["Spring native UI worklet"]
    guard spring.waitForExistence(timeout: 5), spring.isHittable else {
      XCTFail("The native UI worklet spring control was not hittable.")
      return
    }
    spring.tap()
    guard application.staticTexts["Native UI worklet spring completed"]
      .waitForExistence(timeout: 8)
    else {
      XCTFail("The analytical CADisplayLink spring did not settle.")
      return
    }
    XCTAssertTrue(target.exists)

    let decay = application.buttons["Decay native UI worklet"]
    guard decay.waitForExistence(timeout: 5), decay.isHittable else {
      XCTFail("The native UI worklet decay control was not hittable.")
      return
    }
    decay.tap()
    guard application.staticTexts["Native UI worklet decay completed"]
      .waitForExistence(timeout: 8)
    else {
      XCTFail("The analytical CADisplayLink decay did not settle.")
      return
    }
    XCTAssertTrue(target.exists)

    let gesture = application.buttons["Bind native UI worklet pan"]
    guard gesture.waitForExistence(timeout: 5), gesture.isHittable else {
      XCTFail("The native UI worklet pan control was not hittable.")
      return
    }
    gesture.tap()
    guard application.staticTexts["Native UI worklet pan ready"]
      .waitForExistence(timeout: 8)
    else {
      XCTFail("The native UI worklet pan did not attach.")
      return
    }
    guard target.isHittable else {
      XCTFail("The native UI worklet target was not hittable for a real drag.")
      return
    }
    let dragStart = target.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)
    )
    let dragEnd = dragStart.withOffset(CGVector(dx: 36, dy: 24))
    dragStart.press(forDuration: 0.1, thenDragTo: dragEnd)
    guard application.staticTexts["Native UI worklet pan completed"]
      .waitForExistence(timeout: 8)
    else {
      XCTFail("The native UI-thread pan did not complete.")
      return
    }
    XCTAssertTrue(target.exists)

    let dispose = application.buttons["Dispose native UI worklet proof"]
    guard dispose.waitForExistence(timeout: 5), dispose.isHittable else {
      XCTFail("The native UI worklet dispose control was not hittable.")
      return
    }
    dispose.tap()
    let removed = NSPredicate(format: "exists == false")
    _ = waitForPredicate(
      removed,
      evaluatedWith: target,
      timeout: 5,
      failureMessage: "The native UI worklet target survived owner teardown."
    )
  }

  func testNativeTabsOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let iconOwnershipURL = try XCTUnwrap(
      URL(string: "dev.solidnative.tabs://navigation/icon-ownership-proof")
    )
    let processSeedURL = try XCTUnwrap(
      URL(string: "dev.solidnative.tabs://navigation/process-restoration-seed")
    )
    let coldLinkURL = try XCTUnwrap(
      URL(string: "dev.solidnative.tabs://navigation/settings/detail?source=device-test")
    )
    let removed = NSPredicate(format: "exists == false")

    func open(_ url: URL, failureMessage: String) -> Bool {
      if #available(iOS 16.4, *) {
        application.open(url)
      } else {
        XCUIDevice.shared.system.open(url)
      }
      guard application.wait(for: .runningForeground, timeout: 8) else {
        XCTFail(failureMessage)
        return false
      }
      return true
    }

    func requireNativeTabBar() -> (XCUIElement, XCUIElement)? {
      let tabBar = application.tabBars.firstMatch
      guard tabBar.waitForExistence(timeout: 8) else {
        XCTFail("The iPhone did not mount a native UITabBar.")
        return nil
      }
      XCTAssertEqual(tabBar.buttons.count, 2)
      let home = application.buttons["solid-native-home-tab"]
      let settings = application.buttons["solid-native-settings-tab"]
      guard home.waitForExistence(timeout: 5), settings.waitForExistence(timeout: 5) else {
        XCTFail("The native tab items did not expose their test identifiers.")
        return nil
      }
      XCTAssertEqual(home.label, "Home tab")
      XCTAssertEqual(settings.label, "Settings tab")
      XCTAssertFalse(home.frame.isEmpty)
      XCTAssertFalse(settings.frame.isEmpty)
      return (home, settings)
    }

    func performNativeBackGesture() {
      let start = application.coordinate(
        withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5)
      )
      let end = application.coordinate(
        withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)
      )
      start.press(forDuration: 0.1, thenDragTo: end)
    }

    func performCanceledNativeBackGesture() {
      let start = application.coordinate(
        withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5)
      )
      let end = application.coordinate(
        withNormalizedOffset: CGVector(dx: 0.14, dy: 0.5)
      )
      start.press(
        forDuration: 0.2,
        thenDragTo: end,
        withVelocity: .slow,
        thenHoldForDuration: 0.1
      )
    }

    application.terminate()
    guard open(
      iconOwnershipURL,
      failureMessage: "The native-tabs icon proof URL did not launch the iPhone app."
    ) else {
      return
    }

    let homeContent = application.staticTexts["Solid Native home tab content"]
    Thread.sleep(forTimeInterval: 6.5)
    guard homeContent.waitForExistence(timeout: 10) else {
      XCTFail("The native-tabs icon proof did not mount the Home owner.")
      return
    }
    guard let iconProofTabs = requireNativeTabBar() else { return }
    XCTAssertTrue(iconProofTabs.0.isSelected)
    XCTAssertFalse(iconProofTabs.1.isSelected)
    XCTAssertTrue(
      application.staticTexts["Home tab icon source image"].exists,
      "The native-tabs icon ownership sequence did not restore its raster source."
    )

    application.terminate()
    guard application.wait(for: .notRunning, timeout: 5) else {
      XCTFail("The native-tabs icon proof process did not terminate.")
      return
    }
    guard open(
      processSeedURL,
      failureMessage: "The native-tabs seed URL did not launch the iPhone app."
    ) else {
      return
    }

    guard homeContent.waitForExistence(timeout: 10) else {
      XCTFail("The native-tabs seed did not mount the Home owner.")
      return
    }
    guard let seedTabs = requireNativeTabBar() else { return }
    XCTAssertTrue(seedTabs.0.isSelected)
    XCTAssertFalse(seedTabs.1.isSelected)
    seedTabs.1.tap()

    let settingsContent = application.staticTexts["Solid Native settings tab content"]
    guard settingsContent.waitForExistence(timeout: 5) else {
      XCTFail("The native Settings tab did not become visible.")
      return
    }
    let nestedPush = application.buttons["Open nested settings detail"]
    guard nestedPush.waitForExistence(timeout: 5), nestedPush.isHittable else {
      XCTFail("The nested Settings push was not hittable.")
      return
    }
    nestedPush.tap()
    let detailContent = application.staticTexts["Solid Native nested settings detail"]
    guard detailContent.waitForExistence(timeout: 8) else {
      XCTFail("The process seed did not mount its nested native-stack detail.")
      return
    }
    XCTAssertTrue(
      application.staticTexts["Native tabs routed detail; back true"]
        .waitForExistence(timeout: 5)
    )
    XCTAssertTrue(
      application.staticTexts["Nested settings detail"].waitForExistence(timeout: 5)
    )
    performCanceledNativeBackGesture()
    XCTAssertTrue(
      application.staticTexts["Native tabs selected detail gesture canceled"]
        .waitForExistence(timeout: 8),
      "The selected tab's short iPhone edge gesture did not report natural cancellation."
    )
    XCTAssertTrue(
      detailContent.exists,
      "The selected tab's naturally canceled gesture removed its nested detail."
    )
    XCTAssertTrue(seedTabs.1.isSelected)
    let persist = application.buttons["Persist native tabs for process relaunch"]
    guard persist.waitForExistence(timeout: 5), persist.isHittable else {
      XCTFail("The process seed persistence control was not hittable.")
      return
    }
    persist.tap()
    guard waitForPredicate(
      removed,
      evaluatedWith: detailContent,
      timeout: 8,
      failureMessage: "The seeded native-tabs surface survived owner teardown."
    ) else {
      return
    }
    XCTAssertEqual(application.state, .runningForeground)

    application.terminate()
    guard application.wait(for: .notRunning, timeout: 5) else {
      XCTFail("The seeded native-tabs process did not terminate.")
      return
    }
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The ordinary native-tabs process relaunch did not start.")
      return
    }

    let restoredDetail = application.staticTexts["Solid Native nested settings detail"]
    guard restoredDetail.waitForExistence(timeout: 10) else {
      XCTFail("The new process did not restore the selected nested detail.")
      return
    }
    XCTAssertTrue(
      application.staticTexts["Native tabs process restoration; back true"]
        .waitForExistence(timeout: 5)
    )
    guard let restoredTabs = requireNativeTabBar() else { return }
    XCTAssertFalse(restoredTabs.0.isSelected)
    XCTAssertTrue(restoredTabs.1.isSelected)
    performNativeBackGesture()
    XCTAssertTrue(
      application.staticTexts["Native tabs selected detail Back blocked"]
        .waitForExistence(timeout: 8),
      "The selected tab's first iPhone edge gesture did not reach its blocker."
    )
    XCTAssertTrue(
      restoredDetail.exists,
      "The selected tab's blocker-rejected gesture removed its nested detail."
    )
    XCTAssertTrue(restoredTabs.1.isSelected)
    performNativeBackGesture()
    guard settingsContent.waitForExistence(timeout: 8) else {
      XCTFail("The iPhone left-edge gesture did not restore the Settings root.")
      return
    }
    XCTAssertTrue(
      application.staticTexts["Settings TanStack loader root"]
        .waitForExistence(timeout: 5)
    )
    guard waitForPredicate(
      removed,
      evaluatedWith: restoredDetail,
      timeout: 5,
      failureMessage: "The restored detail survived the iPhone native pop gesture."
    ) else {
      return
    }
    let restoredDispose = application.buttons["Dispose native tabs proof"]
    guard restoredDispose.waitForExistence(timeout: 5), restoredDispose.isHittable else {
      XCTFail("The restored native-tabs disposal control was not hittable.")
      return
    }
    restoredDispose.tap()
    guard waitForPredicate(
      removed,
      evaluatedWith: settingsContent,
      timeout: 8,
      failureMessage: "The restored native-tabs surface survived teardown."
    ) else {
      return
    }
    XCTAssertEqual(application.state, .runningForeground)

    application.terminate()
    guard application.wait(for: .notRunning, timeout: 5) else {
      XCTFail("The restored native-tabs process did not terminate.")
      return
    }
    guard open(
      coldLinkURL,
      failureMessage: "The native-tabs cold URL did not launch a third process."
    ) else {
      return
    }

    let coldDetail = application.staticTexts["Solid Native nested settings detail"]
    guard coldDetail.waitForExistence(timeout: 10) else {
      XCTFail("The cold URL did not mount the nested Settings detail.")
      return
    }
    guard let coldTabs = requireNativeTabBar() else { return }
    XCTAssertFalse(coldTabs.0.isSelected)
    XCTAssertTrue(coldTabs.1.isSelected)
    XCTAssertTrue(
      application.staticTexts["Native tabs cold launch deep-link; back false"]
        .waitForExistence(timeout: 5)
    )
    XCTAssertTrue(
      application.staticTexts["Settings TanStack loader detail"]
        .waitForExistence(timeout: 5)
    )
    let reset = application.buttons["Reset cold-linked settings root"]
    guard reset.waitForExistence(timeout: 5), reset.isHittable else {
      XCTFail("The cold-link reset control was not hittable.")
      return
    }
    reset.tap()
    guard settingsContent.waitForExistence(timeout: 8) else {
      XCTFail("The cold-linked stack did not reset to its root.")
      return
    }
    guard waitForPredicate(
      removed,
      evaluatedWith: coldDetail,
      timeout: 5,
      failureMessage: "The replaced cold-linked detail remained mounted."
    ) else {
      return
    }
    let increment = application.buttons["Increment settings tab state"]
    guard increment.waitForExistence(timeout: 5), increment.isHittable else {
      XCTFail("The retained Settings state control was not hittable.")
      return
    }
    increment.tap()
    XCTAssertTrue(
      application.staticTexts["Settings retained state 1"].waitForExistence(timeout: 5)
    )
    let coldPush = application.buttons["Open nested settings detail"]
    guard coldPush.waitForExistence(timeout: 5), coldPush.isHittable else {
      XCTFail("The cold-link Settings push was not hittable.")
      return
    }
    coldPush.tap()
    let routedDetail = application.staticTexts["Solid Native nested settings detail"]
    guard routedDetail.waitForExistence(timeout: 8) else {
      XCTFail("The Settings tab did not push its second nested detail.")
      return
    }
    XCTAssertTrue(
      application.staticTexts.matching(
        NSPredicate(format: "label BEGINSWITH %@", "Nested detail retained state 1;")
      ).firstMatch.waitForExistence(timeout: 5)
    )

    coldTabs.0.tap()
    guard homeContent.waitForExistence(timeout: 5) else {
      XCTFail("The native Home tab did not become visible.")
      return
    }
    coldTabs.1.tap()
    guard routedDetail.waitForExistence(timeout: 5) else {
      XCTFail("The Settings tab did not retain its nested native screen.")
      return
    }
    XCTAssertTrue(
      application.staticTexts.matching(
        NSPredicate(format: "label BEGINSWITH %@", "Nested detail retained state 1;")
      ).firstMatch.waitForExistence(timeout: 5)
    )
    var retainedPopSucceeded = false
    for _ in 0..<3 {
      performNativeBackGesture()
      if settingsContent.waitForExistence(timeout: 4) {
        retainedPopSucceeded = true
        break
      }
      XCTAssertTrue(
        routedDetail.exists,
        "A naturally canceled retained-tab gesture removed its nested detail."
      )
    }
    guard retainedPopSucceeded else {
      XCTFail("The retained Settings detail did not respond to the native gesture.")
      return
    }
    XCTAssertTrue(
      application.staticTexts["Settings retained state 1"].waitForExistence(timeout: 5)
    )
    let dispose = application.buttons["Dispose native tabs proof"]
    guard dispose.waitForExistence(timeout: 5), dispose.isHittable else {
      XCTFail("The native-tabs terminal disposal control was not hittable.")
      return
    }
    dispose.tap()
    _ = waitForPredicate(
      removed,
      evaluatedWith: settingsContent,
      timeout: 8,
      failureMessage: "The cold-link native-tabs surface survived terminal teardown."
    )
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testNativeTabsProductCompositionOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let productURL = try XCTUnwrap(
      URL(string: "dev.solidnative.tabs://navigation/product-composition")
    )
    let productSessionRestoreURL = try XCTUnwrap(
      URL(string: "dev.solidnative.tabs://navigation/product-session-restore")
    )
    let removed = NSPredicate(format: "exists == false")

    application.terminate()
    if #available(iOS 16.4, *) {
      application.open(productURL)
    } else {
      XCUIDevice.shared.system.open(productURL)
    }
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The composed native-tabs URL did not launch the iPhone app.")
      return
    }

    let login = application.staticTexts["Solid Native product authentication"]
    guard login.waitForExistence(timeout: 10) else {
      XCTFail("The protected launch did not replace its denied route with login.")
      return
    }
    XCTAssertFalse(
      application.staticTexts["Denied product route mounted"].exists,
      "The protected native route mounted before its authentication redirect."
    )
    let settingsTab = application.buttons["solid-native-settings-tab"]
    guard settingsTab.waitForExistence(timeout: 5) else {
      XCTFail("The product flow did not mount its native Settings tab.")
      return
    }
    XCTAssertTrue(settingsTab.isSelected)

    let authenticate = application.buttons["Authenticate composed native flow"]
    guard authenticate.waitForExistence(timeout: 5), authenticate.isHittable else {
      XCTFail("The composed authentication control was not physically hittable.")
      return
    }
    authenticate.tap()
    let settings = application.staticTexts["Solid Native settings tab content"]
    guard settings.waitForExistence(timeout: 8) else {
      XCTFail("Authentication did not replace login with the Settings root.")
      return
    }
    guard waitForPredicate(
      removed,
      evaluatedWith: login,
      timeout: 5,
      failureMessage: "The replaced product login remained mounted."
    ) else {
      return
    }

    let increment = application.buttons["Increment settings tab state"]
    guard increment.waitForExistence(timeout: 5), increment.isHittable else {
      XCTFail("The product Settings state control was not physically hittable.")
      return
    }
    increment.tap()
    XCTAssertTrue(
      application.staticTexts["Settings retained state 1"].waitForExistence(timeout: 5)
    )

    let detailLink = application.links["Open nested settings detail"]
    guard detailLink.waitForExistence(timeout: 5), detailLink.isHittable else {
      XCTFail("The typed product link was not physically hittable.")
      return
    }
    detailLink.tap()
    let detail = application.staticTexts["Solid Native nested settings detail"]
    guard detail.waitForExistence(timeout: 8) else {
      XCTFail("The typed product link did not reveal its async detail.")
      return
    }
    XCTAssertTrue(
      application.staticTexts.matching(
        NSPredicate(format: "label BEGINSWITH %@", "Nested detail retained state 1;")
      ).firstMatch.waitForExistence(timeout: 5)
    )

    let startSheet = application.buttons["Start nested settings sheet load"]
    guard startSheet.waitForExistence(timeout: 5), startSheet.isHittable else {
      XCTFail("The slow native-sheet request was not physically hittable.")
      return
    }
    startSheet.tap()
    let pending = application.staticTexts["Nested settings sheet loading"]
    guard pending.waitForExistence(timeout: 5) else {
      XCTFail("The slow native-sheet request did not expose its pending frame.")
      return
    }
    let interrupt = application.buttons["Interrupt nested settings load with sheet"]
    guard interrupt.waitForExistence(timeout: 5), interrupt.isHittable else {
      XCTFail("The pending native-sheet interruption was not physically hittable.")
      return
    }
    interrupt.tap()
    let sheet = application.staticTexts["Solid Native nested settings sheet"]
    guard sheet.waitForExistence(timeout: 8) else {
      XCTFail("The winning interruption did not present the native sheet.")
      return
    }
    XCTAssertTrue(
      application.staticTexts["Settings TanStack loader sheet"]
        .waitForExistence(timeout: 5)
    )
    XCTAssertTrue(
      application.staticTexts["Native tabs sheet interruption causality verified"]
        .waitForExistence(timeout: 12),
      "The late displaced loader did not settle with bounded causal ownership."
    )
    let sheetNavigationBar = application.navigationBars["Nested settings sheet"]
    guard sheetNavigationBar.waitForExistence(timeout: 8) else {
      XCTFail("The composed sheet did not mount its native navigation bar.")
      return
    }
    let sheetBack = sheetNavigationBar.buttons.firstMatch
    guard sheetBack.waitForExistence(timeout: 5), sheetBack.isHittable else {
      XCTFail("The composed sheet did not expose a native Back control.")
      return
    }
    sheetBack.tap()
    guard detail.waitForExistence(timeout: 8) else {
      XCTFail("The native sheet Back control did not reveal the retained detail.")
      return
    }
    guard waitForPredicate(
      removed,
      evaluatedWith: sheet,
      timeout: 5,
      failureMessage: "The native sheet remained after its platform Back transition."
    ) else {
      return
    }

    let homeTab = application.buttons["solid-native-home-tab"]
    guard homeTab.waitForExistence(timeout: 5), homeTab.isHittable else {
      XCTFail("The retained product Home tab was not physically hittable.")
      return
    }
    homeTab.tap()
    XCTAssertTrue(
      application.staticTexts["Solid Native home tab content"].waitForExistence(timeout: 5)
    )
    settingsTab.tap()
    guard detail.waitForExistence(timeout: 5) else {
      XCTFail("The product Settings tab did not retain its async detail.")
      return
    }
    XCTAssertTrue(
      application.staticTexts.matching(
        NSPredicate(format: "label BEGINSWITH %@", "Nested detail retained state 1;")
      ).firstMatch.waitForExistence(timeout: 5)
    )

    let detailNavigationBar = application.navigationBars["Nested settings detail"]
    guard detailNavigationBar.waitForExistence(timeout: 5) else {
      XCTFail("The retained detail did not expose its native navigation bar.")
      return
    }
    let detailBack = detailNavigationBar.buttons.firstMatch
    guard detailBack.waitForExistence(timeout: 5), detailBack.isHittable else {
      XCTFail("The retained detail did not expose a native Back control.")
      return
    }
    detailBack.tap()
    guard settings.waitForExistence(timeout: 8) else {
      XCTFail("The retained detail Back control did not reveal the original root.")
      return
    }
    XCTAssertTrue(
      application.staticTexts["Settings retained state 1"].waitForExistence(timeout: 5)
    )

    let dispose = application.buttons["Dispose native tabs proof"]
    guard dispose.waitForExistence(timeout: 5), dispose.isHittable else {
      XCTFail("The composed native-tabs teardown control was not physically hittable.")
      return
    }
    dispose.tap()
    _ = waitForPredicate(
      removed,
      evaluatedWith: settings,
      timeout: 8,
      failureMessage: "The composed native-tabs surface survived terminal teardown."
    )
    XCTAssertEqual(application.state, .runningForeground)

    application.terminate()
    if #available(iOS 16.4, *) {
      application.open(productSessionRestoreURL)
    } else {
      XCUIDevice.shared.system.open(productSessionRestoreURL)
    }
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The secure-session restoration URL did not relaunch the iPhone app.")
      return
    }
    let restoredSession = application.staticTexts[
      "Solid Native restored protected session"
    ]
    guard restoredSession.waitForExistence(timeout: 10) else {
      XCTFail("The fresh app process did not restore its Keychain session.")
      return
    }
    XCTAssertFalse(
      application.staticTexts["Solid Native product authentication"].exists,
      "The restored device credential exposed the login route."
    )
    let clearSession = application.buttons["Clear restored session and dispose"]
    guard clearSession.waitForExistence(timeout: 5), clearSession.isHittable else {
      XCTFail("The secure logout control was not physically hittable.")
      return
    }
    clearSession.tap()
    _ = waitForPredicate(
      removed,
      evaluatedWith: restoredSession,
      timeout: 8,
      failureMessage: "The restored secure-session surface survived logout teardown."
    )
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testNavigationProcessRestorationOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let processSeedURL = try XCTUnwrap(
      URL(string: "dev.solidnative.navigation://navigation/process-restoration-seed")
    )
    let coldLinkURL = try XCTUnwrap(
      URL(string: "dev.solidnative.navigation://navigation/cold-link?source=device-test")
    )
    let removed = NSPredicate(format: "exists == false")

    func open(_ url: URL, failureMessage: String) -> Bool {
      if #available(iOS 16.4, *) {
        application.open(url)
      } else {
        XCUIDevice.shared.system.open(url)
      }
      guard application.wait(for: .runningForeground, timeout: 8) else {
        XCTFail(failureMessage)
        return false
      }
      return true
    }

    func requireLoaderState(_ prefix: String, failureMessage: String) -> Bool {
      let state = application.staticTexts.matching(
        NSPredicate(format: "label BEGINSWITH %@", prefix)
      ).firstMatch
      guard state.waitForExistence(timeout: 8) else {
        XCTFail(failureMessage)
        return false
      }
      return true
    }

    func requireNavigationBar(_ title: String) -> Bool {
      let navigationBar = application.navigationBars[title]
      guard navigationBar.waitForExistence(timeout: 8) else {
        XCTFail("The iPhone did not mount the native \(title) navigation bar.")
        return false
      }
      XCTAssertFalse(navigationBar.frame.isEmpty)
      return true
    }

    func performNativeBackGesture() {
      let start = application.coordinate(
        withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5)
      )
      let end = application.coordinate(
        withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)
      )
      start.press(forDuration: 0.1, thenDragTo: end)
    }

    func performCanceledNativeBackGesture() {
      let start = application.coordinate(
        withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5)
      )
      let end = application.coordinate(
        withNormalizedOffset: CGVector(dx: 0.14, dy: 0.5)
      )
      start.press(
        forDuration: 0.2,
        thenDragTo: end,
        withVelocity: .slow,
        thenHoldForDuration: 0.1
      )
    }

    application.terminate()
    guard open(
      processSeedURL,
      failureMessage: "The navigation-process seed URL did not launch the iPhone app."
    ) else {
      return
    }

    let root = application.staticTexts[
      "Solid Native process-restored navigation root"
    ].firstMatch
    guard root.waitForExistence(timeout: 10) else {
      XCTFail("The navigation-process seed did not mount its root route.")
      return
    }
    guard requireLoaderState(
      "Navigation process loader root;",
      failureMessage: "The root TanStack loader did not reach the Solid route component."
    ), requireNavigationBar("Restored root") else {
      return
    }

    let rootScrollView = application.descendants(matching: .any)[
      "solid-native-navigation-restoration-scroll-view"
    ]
    guard rootScrollView.waitForExistence(timeout: 5), rootScrollView.isHittable else {
      XCTFail("The navigation-process seed did not expose its native UIScrollView.")
      return
    }
    XCTAssertFalse(rootScrollView.frame.isEmpty)
    let unscrolledRootY = root.frame.minY
    let scrollStart = rootScrollView.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)
    )
    let scrollEnd = rootScrollView.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.32)
    )
    scrollStart.press(
      forDuration: 0.2,
      thenDragTo: scrollEnd,
      withVelocity: .slow,
      thenHoldForDuration: 0.2
    )
    let capturedRootY = root.frame.minY
    XCTAssertLessThanOrEqual(
      capturedRootY,
      unscrolledRootY - 320,
      "The physical iPhone drag did not capture the durable 320-point root offset."
    )

    let push = application.links["Open process-restored navigation detail"]
    guard push.waitForExistence(timeout: 5), push.isHittable else {
      XCTFail("The navigation-process seed push was not physically hittable.")
      return
    }
    push.tap()
    let detail = application.staticTexts[
      "Solid Native process-restored navigation detail"
    ]
    guard detail.waitForExistence(timeout: 8) else {
      XCTFail("The navigation-process seed did not mount its detail route.")
      return
    }
    guard requireLoaderState(
      "Navigation process loader detail;",
      failureMessage: "The detail TanStack loader did not reach the Solid route component."
    ), requireNavigationBar("Restored detail") else {
      return
    }
    XCTAssertTrue(
      application.staticTexts["Native navigation routed detail; back true"]
        .waitForExistence(timeout: 5),
      "The seeded detail did not expose a two-entry native history."
    )

    let headerAction = application.buttons[
      "Run detail native header action"
    ]
    guard headerAction.waitForExistence(timeout: 5), headerAction.isHittable else {
      XCTFail("The Solid-owned native header button was not physically hittable.")
      return
    }
    headerAction.tap()
    XCTAssertTrue(
      application.staticTexts["Detail header action complete"]
        .waitForExistence(timeout: 8),
      "The native header button did not deliver its event into Solid."
    )

    let headerMenu = application.buttons[
      "Open detail native header menu"
    ]
    guard headerMenu.waitForExistence(timeout: 5), headerMenu.isHittable else {
      XCTFail("The Solid-owned native header menu was not physically hittable.")
      return
    }
    headerMenu.tap()
    let nestedMenu = application.buttons[
      "Nested native header menu"
    ]
    guard nestedMenu.waitForExistence(timeout: 5), nestedMenu.isHittable else {
      XCTFail("The native header submenu did not become physically hittable.")
      return
    }
    nestedMenu.tap()
    let nestedAction = application.buttons[
      "Confirm nested native header menu"
    ]
    guard nestedAction.waitForExistence(timeout: 5), nestedAction.isHittable else {
      XCTFail("The nested native header-menu action was not physically hittable.")
      return
    }
    nestedAction.tap()
    XCTAssertTrue(
      application.staticTexts["Detail header menu action complete"]
        .waitForExistence(timeout: 8),
      "The nested native header-menu event did not resolve the Solid callback."
    )

    performCanceledNativeBackGesture()
    XCTAssertTrue(
      application.staticTexts["Native navigation platform gesture canceled"]
        .waitForExistence(timeout: 8),
      "The short iPhone edge gesture did not report natural cancellation."
    )
    XCTAssertTrue(
      detail.exists,
      "The naturally canceled iPhone gesture removed the seeded detail screen."
    )
    guard requireNavigationBar("Restored detail") else { return }

    let persist = application.buttons["Persist navigation for process relaunch"]
    guard persist.waitForExistence(timeout: 5), persist.isHittable else {
      XCTFail("The navigation-process persistence control was not hittable.")
      return
    }
    persist.tap()
    guard waitForPredicate(
      removed,
      evaluatedWith: detail,
      timeout: 8,
      failureMessage: "The seeded navigation surface survived owner teardown."
    ) else {
      return
    }
    XCTAssertEqual(application.state, .runningForeground)

    application.terminate()
    guard application.wait(for: .notRunning, timeout: 5) else {
      XCTFail("The seeded navigation process did not terminate.")
      return
    }
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The ordinary navigation-process relaunch did not start.")
      return
    }

    let restoredDetail = application.staticTexts[
      "Solid Native process-restored navigation detail"
    ]
    guard restoredDetail.waitForExistence(timeout: 10) else {
      XCTFail("The new iPhone process did not restore the detail route.")
      return
    }
    guard requireLoaderState(
      "Navigation process loader detail;",
      failureMessage: "The restored detail loader did not settle."
    ), requireNavigationBar("Restored detail") else {
      return
    }
    XCTAssertTrue(
      application.staticTexts["Native navigation process restoration; back true"]
        .waitForExistence(timeout: 8),
      "The second iPhone process did not expose restored Back state."
    )

    performNativeBackGesture()
    XCTAssertTrue(
      application.staticTexts["Native navigation platform Back blocked"]
        .waitForExistence(timeout: 8),
      "The first iPhone edge gesture did not reach the TanStack blocker."
    )
    XCTAssertTrue(
      restoredDetail.exists,
      "The blocker-rejected iPhone gesture removed the detail screen."
    )
    guard requireNavigationBar("Restored detail") else { return }

    performNativeBackGesture()
    guard root.waitForExistence(timeout: 8) else {
      XCTFail("The allowed iPhone left-edge gesture did not reveal the preloaded root.")
      return
    }
    guard requireLoaderState(
      "Navigation process loader root;",
      failureMessage: "The bounded restored-root preload was not visible after Back."
    ), requireNavigationBar("Restored root") else {
      return
    }
    let restoredRootScrollView = application.descendants(matching: .any)[
      "solid-native-navigation-restoration-scroll-view"
    ]
    guard restoredRootScrollView.waitForExistence(timeout: 5),
      restoredRootScrollView.isHittable
    else {
      XCTFail("The restored navigation root did not expose its replacement UIScrollView.")
      return
    }
    XCTAssertEqual(
      root.frame.minY,
      capturedRootY,
      accuracy: 4,
      "The replacement UIScrollView did not restore the process-persisted offset."
    )
    guard waitForPredicate(
      removed,
      evaluatedWith: restoredDetail,
      timeout: 5,
      failureMessage: "The restored detail survived the iPhone native pop gesture."
    ) else {
      return
    }
    let restoredDispose = application.buttons["Dispose navigation process proof"]
    guard restoredDispose.waitForExistence(timeout: 5), restoredDispose.isHittable else {
      XCTFail("The restored navigation disposal control was not hittable.")
      return
    }
    restoredDispose.tap()
    guard waitForPredicate(
      removed,
      evaluatedWith: root,
      timeout: 8,
      failureMessage: "The restored navigation surface survived teardown."
    ) else {
      return
    }
    XCTAssertEqual(application.state, .runningForeground)

    application.terminate()
    guard application.wait(for: .notRunning, timeout: 5) else {
      XCTFail("The restored navigation process did not terminate.")
      return
    }
    guard open(
      coldLinkURL,
      failureMessage: "The navigation cold URL did not launch a third iPhone process."
    ) else {
      return
    }

    let linked = application.staticTexts[
      "Solid Native process-safe cold navigation link"
    ]
    guard linked.waitForExistence(timeout: 10) else {
      XCTFail("The accepted cold URL did not mount its isolated linked route.")
      return
    }
    guard requireLoaderState(
      "Navigation process loader linked",
      failureMessage: "The cold-linked TanStack loader did not settle."
    ), requireNavigationBar("Cold link") else {
      return
    }
    XCTAssertTrue(
      application.staticTexts["Native navigation cold launch; back false"]
        .waitForExistence(timeout: 5),
      "The cold-linked third process retained an unexpected Back entry."
    )
    let coldDispose = application.buttons["Dispose navigation process proof"]
    guard coldDispose.waitForExistence(timeout: 5), coldDispose.isHittable else {
      XCTFail("The cold-linked navigation disposal control was not hittable.")
      return
    }
    coldDispose.tap()
    _ = waitForPredicate(
      removed,
      evaluatedWith: linked,
      timeout: 8,
      failureMessage: "The cold-linked navigation surface survived terminal teardown."
    )
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testNavigationSheetDetentsOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let sheetURL = try XCTUnwrap(
      URL(string: "dev.solidnative.navigation://navigation/native-sheet-detents")
    )
    let removed = NSPredicate(format: "exists == false")

    application.terminate()
    if #available(iOS 16.4, *) {
      application.open(sheetURL)
    } else {
      XCUIDevice.shared.system.open(sheetURL)
    }
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The native-sheet URL did not launch the iPhone app.")
      return
    }

    let root = application.staticTexts[
      "Solid Native process-restored navigation root"
    ]
    guard root.waitForExistence(timeout: 10) else {
      XCTFail("The native-sheet proof did not mount its Solid root route.")
      return
    }
    let push = application.links["Open process-restored navigation detail"]
    guard push.waitForExistence(timeout: 5), push.isHittable else {
      XCTFail("The native-sheet presentation control was not physically hittable.")
      return
    }
    push.tap()

    let detail = application.staticTexts[
      "Solid Native process-restored navigation detail"
    ]
    guard detail.waitForExistence(timeout: 8) else {
      XCTFail("The Solid-owned native sheet did not present its detail route.")
      return
    }
    let grabber = application.buttons["Sheet Grabber"]
    guard grabber.waitForExistence(timeout: 8), grabber.isHittable else {
      XCTFail("The native sheet did not expose its physical UIKit grabber.")
      return
    }
    let expandedFrame = grabber.frame
    XCTAssertFalse(expandedFrame.isEmpty)
    XCTAssertEqual(grabber.value as? String, "Expanded")
    XCTAssertGreaterThan(expandedFrame.minY, application.frame.minY)

    let collapsedTarget = application.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.43)
    )
    grabber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
      forDuration: 0.15,
      thenDragTo: collapsedTarget,
      withVelocity: .slow,
      thenHoldForDuration: 0.1
    )

    guard application.staticTexts["Native sheet detent 0 stable"]
      .waitForExistence(timeout: 8) else {
      XCTFail("The physical iPhone drag did not enter the smaller native detent.")
      return
    }
    XCTAssertTrue(detail.exists, "Changing detents recreated or removed the Solid route.")
    guard waitForPredicate(
      NSPredicate(format: "value == %@", "Half screen"),
      evaluatedWith: grabber,
      timeout: 5,
      failureMessage: "The physical UIKit grabber did not enter its half-screen state."
    ) else {
      return
    }
    let collapsedFrame = grabber.frame
    XCTAssertGreaterThan(
      collapsedFrame.minY,
      expandedFrame.minY + 40,
      "The native sheet reported detent 0 without moving its UIKit container."
    )

    let disposeCandidates = application.buttons.matching(
      identifier: "Dispose navigation process proof"
    )
    var hittableDispose: XCUIElement?
    for index in 0..<disposeCandidates.count {
      let candidate = disposeCandidates.element(boundBy: index)
      if candidate.exists && candidate.isHittable {
        hittableDispose = candidate
        break
      }
    }
    guard let dispose = hittableDispose else {
      XCTFail("The collapsed native sheet did not expose its teardown control.")
      return
    }
    dispose.tap()
    guard waitForPredicate(
      removed,
      evaluatedWith: detail,
      timeout: 8,
      failureMessage: "The Solid-owned native sheet survived terminal teardown."
    ) else {
      return
    }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testVirtualizedListOnPhysicalDevice() throws {
    let application = XCUIApplication()
    application.terminate()
    application.launch()

    let ready = application.staticTexts[
      "Solid Native VirtualizedList ready"
    ]
    guard ready.waitForExistence(timeout: 10) else {
      XCTFail("The iPhone VirtualizedList proof did not become ready.")
      return
    }

    let listContainer = application.otherElements[
      "solid-native-virtualized-list"
    ]
    guard listContainer.waitForExistence(timeout: 8) else {
      XCTFail("The iPhone did not expose the VirtualizedList container.")
      return
    }
    XCTAssertEqual(listContainer.label, "Solid Native virtualized list")
    XCTAssertGreaterThan(listContainer.frame.width, 0)
    XCTAssertEqual(listContainer.frame.height, 392, accuracy: 1)
    let list = listContainer.scrollViews.firstMatch
    guard list.waitForExistence(timeout: 5) else {
      XCTFail("The VirtualizedList container did not expose its native UIScrollView.")
      return
    }
    XCTAssertTrue(list.isHittable)
    XCTAssertGreaterThan(list.frame.width, 0)
    XCTAssertEqual(list.frame.height, 392, accuracy: 1)

    let rows = application.staticTexts.matching(
      NSPredicate(format: "label BEGINSWITH %@", "Virtualized row ")
    )
    func accessibleRowLabels() -> Set<String> {
      Set((0..<rows.count).map { rows.element(boundBy: $0).label })
    }
    var rowLabels = accessibleRowLabels()
    XCTAssertGreaterThan(rowLabels.count, 0)
    XCTAssertLessThanOrEqual(rowLabels.count, 12)
    let firstRow = application.staticTexts["Virtualized row 0"].firstMatch
    guard firstRow.waitForExistence(timeout: 5) else {
      XCTFail("The initial keyed VirtualizedList row was not accessible.")
      return
    }

    let measureOptions = XCTMeasureOptions.default
    measureOptions.iterationCount = 1
    var scrollMetrics: [any XCTMetric] = [
      XCTOSSignpostMetric.scrollingAndDecelerationMetric
    ]
    if #available(iOS 26.0, *) {
      scrollMetrics.append(XCTHitchMetric(application: application))
    }
    measure(metrics: scrollMetrics, options: measureOptions) {
      let dragStart = list.coordinate(
        withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)
      )
      let dragEnd = list.coordinate(
        withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)
      )
      dragStart.press(forDuration: 0.1, thenDragTo: dragEnd)
    }

    let physicalSucceeded = application.staticTexts[
      "Solid Native VirtualizedList physical scroll mounted"
    ]
    guard physicalSucceeded.waitForExistence(timeout: 10) else {
      XCTFail("The physical iPhone scroll did not mount its bounded Solid window.")
      return
    }
    guard waitForPredicate(
      NSPredicate(format: "exists == false"),
      evaluatedWith: firstRow,
      timeout: 5,
      failureMessage: "Row zero remained mounted after the physical iPhone scroll."
    ) else {
      return
    }
    rowLabels = accessibleRowLabels()
    XCTAssertGreaterThan(rowLabels.count, 0)
    XCTAssertLessThanOrEqual(rowLabels.count, 12)

    let visibleAnchor = (0..<rows.count)
      .map { rows.element(boundBy: $0) }
      .filter {
        $0.exists && $0.isHittable && !$0.frame.isEmpty
          && $0.frame.intersects(list.frame)
      }
      .sorted { $0.frame.minY < $1.frame.minY }
      .first
    guard let anchor = visibleAnchor else {
      XCTFail("The scrolled iPhone VirtualizedList exposed no visible keyed anchor.")
      return
    }
    let anchorLabel = anchor.label
    let anchorFrame = anchor.frame
    let prepend = application.buttons["Prepend 50 virtualized rows"]
    guard prepend.waitForExistence(timeout: 5), prepend.isHittable else {
      XCTFail("The VirtualizedList prepend control was not physically hittable.")
      return
    }
    prepend.tap()

    XCTAssertTrue(
      application.staticTexts[
        "Solid Native VirtualizedList prepend anchor retained"
      ].waitForExistence(timeout: 10),
      "The iPhone keyed prepend did not complete."
    )
    let retainedAnchor = application.staticTexts[anchorLabel].firstMatch
    XCTAssertTrue(
      retainedAnchor.waitForExistence(timeout: 5),
      "The iPhone keyed prepend unmounted its visible anchor."
    )
    XCTAssertEqual(retainedAnchor.frame.minY, anchorFrame.minY, accuracy: 1)
    XCTAssertEqual(retainedAnchor.frame.maxY, anchorFrame.maxY, accuracy: 1)
    rowLabels = accessibleRowLabels()
    XCTAssertGreaterThan(rowLabels.count, 0)
    XCTAssertLessThanOrEqual(rowLabels.count, 12)

    let imperative = application.buttons["Jump to virtualized row 900"]
    guard imperative.waitForExistence(timeout: 5), imperative.isHittable else {
      XCTFail("The VirtualizedList imperative command was not physically hittable.")
      return
    }
    imperative.tap()

    XCTAssertTrue(
      application.staticTexts[
        "Solid Native VirtualizedList imperative index mounted"
      ].waitForExistence(timeout: 10),
      "The iPhone imperative index command did not complete."
    )
    XCTAssertTrue(
      application.staticTexts["Virtualized row 900"].firstMatch
        .waitForExistence(timeout: 5),
      "The iPhone imperative index command did not mount row 900."
    )
    rowLabels = accessibleRowLabels()
    XCTAssertGreaterThan(rowLabels.count, 0)
    XCTAssertLessThanOrEqual(rowLabels.count, 12)

    let dispose = application.buttons["Dispose virtualized list proof"]
    guard dispose.waitForExistence(timeout: 5), dispose.isHittable else {
      XCTFail("The VirtualizedList disposal control was not physically hittable.")
      return
    }
    dispose.tap()
    _ = waitForPredicate(
      NSPredicate(format: "exists == false"),
      evaluatedWith: listContainer,
      timeout: 10,
      failureMessage: "The iPhone VirtualizedList survived terminal teardown."
    )
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testInitialVirtualizedListOnPhysicalDevice() throws {
    let application = XCUIApplication()
    application.terminate()
    application.launch()

    let ready = application.staticTexts[
      "Solid Native initial VirtualizedList ready"
    ]
    guard ready.waitForExistence(timeout: 10) else {
      XCTFail("The iPhone initial VirtualizedList proof did not become ready.")
      return
    }

    let listContainer = application.otherElements[
      "solid-native-initial-virtualized-list"
    ]
    guard listContainer.waitForExistence(timeout: 8) else {
      XCTFail("The iPhone did not expose the initially positioned VirtualizedList.")
      return
    }
    XCTAssertEqual(listContainer.label, "Solid Native initial virtualized list")
    XCTAssertGreaterThan(listContainer.frame.width, 0)
    XCTAssertEqual(listContainer.frame.height, 350, accuracy: 1)
    let list = listContainer.scrollViews.firstMatch
    guard list.waitForExistence(timeout: 5) else {
      XCTFail("The initial VirtualizedList did not expose its native UIScrollView.")
      return
    }
    XCTAssertTrue(list.isHittable)
    XCTAssertEqual(list.frame.height, 350, accuracy: 1)

    let rows = application.staticTexts.matching(
      NSPredicate(format: "label BEGINSWITH %@", "Initial virtualized row ")
    )
    func accessibleRowLabels() -> Set<String> {
      Set((0..<rows.count).map { rows.element(boundBy: $0).label })
    }
    let target = application.staticTexts["Initial virtualized row 100"].firstMatch
    guard target.waitForExistence(timeout: 5) else {
      XCTFail("The iPhone initial window did not expose row 100.")
      return
    }
    let expectedLabels = Set((100...106).map { "Initial virtualized row \($0)" })
    XCTAssertEqual(
      accessibleRowLabels(),
      expectedLabels,
      "The iPhone first native tree did not contain exactly rows 100 through 106."
    )
    XCTAssertFalse(
      application.staticTexts["Initial virtualized row 0"].firstMatch.exists,
      "The iPhone initially positioned list exposed row zero."
    )
    XCTAssertEqual(target.frame.height, 50, accuracy: 1)
    XCTAssertEqual(
      target.frame.minY,
      list.frame.minY,
      accuracy: 1,
      "The initial stable key was not aligned to the native viewport start."
    )

    let dispose = application.buttons["Dispose initial VirtualizedList proof"]
    guard dispose.waitForExistence(timeout: 5), dispose.isHittable else {
      XCTFail("The initial VirtualizedList disposal control was not physically hittable.")
      return
    }
    dispose.tap()
    _ = waitForPredicate(
      NSPredicate(format: "exists == false"),
      evaluatedWith: listContainer,
      timeout: 10,
      failureMessage: "The iPhone initial VirtualizedList survived terminal teardown."
    )
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testMeasuredVirtualizedListOnPhysicalDevice() throws {
    let application = XCUIApplication()
    application.terminate()
    application.launch()

    let ready = application.staticTexts[
      "Solid Native measured VirtualizedList ready"
    ]
    guard ready.waitForExistence(timeout: 10) else {
      XCTFail("The iPhone measured VirtualizedList proof did not become ready.")
      return
    }

    let listContainer = application.otherElements[
      "solid-native-measured-virtualized-list"
    ]
    guard listContainer.waitForExistence(timeout: 8) else {
      XCTFail("The iPhone did not expose the measured VirtualizedList container.")
      return
    }
    XCTAssertEqual(listContainer.label, "Solid Native measured virtualized list")
    XCTAssertGreaterThan(listContainer.frame.width, 0)
    XCTAssertEqual(listContainer.frame.height, 392, accuracy: 1)
    let list = listContainer.scrollViews.firstMatch
    guard list.waitForExistence(timeout: 5) else {
      XCTFail("The measured VirtualizedList did not expose its native UIScrollView.")
      return
    }
    XCTAssertTrue(list.isHittable)
    XCTAssertEqual(list.frame.height, 392, accuracy: 1)

    let rows = application.otherElements.matching(
      NSPredicate(format: "label BEGINSWITH %@", "Measured virtualized row ")
    )
    func accessibleRowLabels() -> Set<String> {
      Set((0..<rows.count).map { rows.element(boundBy: $0).label })
    }
    var rowLabels = accessibleRowLabels()
    XCTAssertGreaterThan(rowLabels.count, 0)
    XCTAssertLessThanOrEqual(rowLabels.count, 15)

    let firstRow = application.otherElements["Measured virtualized row 0"].firstMatch
    let secondRow = application.otherElements["Measured virtualized row 1"].firstMatch
    let thirdRow = application.otherElements["Measured virtualized row 2"].firstMatch
    for row in [firstRow, secondRow, thirdRow] {
      guard row.waitForExistence(timeout: 5) else {
        XCTFail("The initial measured VirtualizedList rows were not accessible.")
        return
      }
    }
    XCTAssertEqual(firstRow.frame.height, 40, accuracy: 1)
    XCTAssertEqual(secondRow.frame.height, 80, accuracy: 1)
    XCTAssertEqual(thirdRow.frame.height, 40, accuracy: 1)
    XCTAssertEqual(firstRow.frame.maxY, secondRow.frame.minY, accuracy: 1)
    XCTAssertEqual(secondRow.frame.maxY, thirdRow.frame.minY, accuracy: 1)

    let dragStart = list.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)
    )
    let dragEnd = list.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)
    )
    dragStart.press(forDuration: 0.1, thenDragTo: dragEnd)

    let physicalSucceeded = application.staticTexts[
      "Solid Native measured VirtualizedList physical scroll mounted"
    ]
    guard physicalSucceeded.waitForExistence(timeout: 10) else {
      XCTFail("The physical iPhone scroll did not settle the measured Solid window.")
      return
    }
    guard waitForPredicate(
      NSPredicate(format: "exists == false"),
      evaluatedWith: firstRow,
      timeout: 5,
      failureMessage: "Measured row zero remained mounted after the physical iPhone scroll."
    ) else {
      return
    }
    rowLabels = accessibleRowLabels()
    XCTAssertGreaterThan(rowLabels.count, 0)
    XCTAssertLessThanOrEqual(rowLabels.count, 15)
    XCTAssertTrue(
      rowLabels.contains { label in
        guard let index = Int(label.replacingOccurrences(
          of: "Measured virtualized row ",
          with: ""
        )) else {
          return false
        }
        return index >= 8
      },
      "The physical iPhone scroll did not expose a later measured row."
    )
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testPressableOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let removed = NSPredicate(format: "exists == false")
    application.terminate()
    application.launch()

    let ready = application.staticTexts["Solid Native Pressable ready"].firstMatch
    guard ready.waitForExistence(timeout: 10) else {
      XCTFail("The Solid Native Pressable proof did not mount on the iPhone.")
      return
    }

    func requireButton(_ label: String) -> XCUIElement? {
      let button = application.buttons[label].firstMatch
      guard button.waitForExistence(timeout: 5), button.isHittable else {
        XCTFail("The Pressable control \(label) was not physically hittable.")
        return nil
      }
      guard !button.frame.isEmpty, application.frame.intersects(button.frame) else {
        XCTFail("The Pressable control \(label) had no visible physical frame.")
        return nil
      }
      return button
    }

    func waitForStatus(_ pattern: String, failureMessage: String) -> Bool {
      let status = application.staticTexts.matching(
        NSPredicate(format: "label MATCHES %@", pattern)
      ).firstMatch
      guard status.waitForExistence(timeout: 8) else {
        XCTFail(failureMessage)
        return false
      }
      return true
    }

    guard let retention = requireButton("Diagonal retained-region Pressable") else {
      return
    }
    let retentionStart = retention.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)
    )
    let retentionEnd = retentionStart.withOffset(CGVector(dx: 155, dy: 90))
    retentionStart.press(
      forDuration: 0.15,
      thenDragTo: retentionEnd,
      withVelocity: .slow,
      thenHoldForDuration: 0.1
    )
    guard waitForStatus(
      "Retention in=1 out=1 move=([3-9]|[1-9][0-9]+) press=0",
      failureMessage: "The iPhone diagonal drag did not exit the retained press region."
    ) else {
      return
    }
    retention.tap()
    guard waitForStatus(
      "Retention in=2 out=2 move=([3-9]|[1-9][0-9]+) press=1",
      failureMessage: "The retained-region Pressable did not recover on the next iPhone gesture."
    ) else {
      return
    }

    guard let cancellation = requireButton("Cancellation recovery Pressable") else {
      return
    }
    let cancellationStart = cancellation.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)
    )
    let cancellationEnd = cancellationStart.withOffset(CGVector(dx: 170, dy: 80))
    cancellationStart.press(
      forDuration: 0.15,
      thenDragTo: cancellationEnd,
      withVelocity: .slow,
      thenHoldForDuration: 0.1
    )
    guard waitForStatus(
      "Cancellation in=1 out=1 move=[0-9]+ press=0",
      failureMessage: "The iPhone did not suppress the displaced Pressable release."
    ) else {
      return
    }
    cancellation.tap()
    guard waitForStatus(
      "Cancellation in=2 out=2 move=[0-9]+ press=1",
      failureMessage: "The displaced Pressable did not recover on the next iPhone tap."
    ) else {
      return
    }

    guard let ripple = requireButton("Native foreground ripple Pressable") else {
      return
    }
    ripple.tap()
    guard waitForStatus(
      "Ripple in=1 out=1 move=[0-9]+ press=1",
      failureMessage: "The platform-neutral iPhone Pressable tap did not complete."
    ) else {
      return
    }

    let scrollView = application.scrollViews.firstMatch
    guard scrollView.waitForExistence(timeout: 5), scrollView.isHittable else {
      XCTFail("The Pressable proof did not expose its native UIScrollView.")
      return
    }
    guard let scroll = requireButton("Scroll takeover Pressable") else {
      return
    }
    let scrollStart = scroll.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)
    )
    let scrollEnd = scrollStart.withOffset(CGVector(dx: 0, dy: -120))
    scrollStart.press(
      forDuration: 0.15,
      thenDragTo: scrollEnd,
      withVelocity: .slow,
      thenHoldForDuration: 0.1
    )
    guard waitForStatus(
      "Scroll in=1 out=1 move=[0-9]+ press=0 y=[1-9][0-9]*",
      failureMessage: "The native UIScrollView did not take over the iPhone gesture."
    ) else {
      return
    }

    guard let dispose = requireButton("Dispose Solid Native Pressable proof") else {
      return
    }
    dispose.tap()
    guard waitForPredicate(
      removed,
      evaluatedWith: ready,
      timeout: 10,
      failureMessage: "The iPhone Pressable tree survived terminal teardown."
    ) else {
      return
    }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testRefreshableScrollViewOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let removed = NSPredicate(format: "exists == false")
    application.terminate()
    application.launch()

    let status = application.staticTexts["solid-native-refresh-status"]
    guard status.waitForExistence(timeout: 10) else {
      XCTFail("The iPhone pull-to-refresh proof did not become ready.")
      return
    }
    XCTAssertEqual(status.label, "Solid Native pull to refresh ready")

    let scrollView = application.scrollViews.firstMatch
    guard scrollView.waitForExistence(timeout: 8) else {
      XCTFail("The iPhone did not expose the backing native UIScrollView.")
      return
    }
    XCTAssertEqual(application.scrollViews.count, 1)
    XCTAssertTrue(scrollView.isHittable)
    XCTAssertGreaterThan(scrollView.frame.width, 0)
    XCTAssertGreaterThan(scrollView.frame.height, 0)
    let retainedFrame = scrollView.frame

    func pullToRefresh() {
      let dragStart = scrollView.coordinate(
        withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)
      )
      let dragEnd = scrollView.coordinate(
        withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)
      )
      dragStart.press(forDuration: 0.15, thenDragTo: dragEnd)
    }

    pullToRefresh()
    guard waitForPredicate(
      NSPredicate(format: "label == %@", "Rejected native refresh 1"),
      evaluatedWith: status,
      timeout: 10,
      failureMessage: "The first physical iPhone pull did not exercise controlled rejection."
    ) else {
      return
    }
    XCTAssertTrue(scrollView.exists)
    XCTAssertEqual(scrollView.frame, retainedFrame)

    // Let UIKit finish the rejected control's return animation before the next
    // physical gesture. The JavaScript state remains false throughout it.
    Thread.sleep(forTimeInterval: 1)
    pullToRefresh()
    // XCTest waits for the native refresh animation to become idle before the
    // drag call returns, so the transient accepted label is sealed from the
    // device log marker after this durable completion assertion.
    guard waitForPredicate(
      NSPredicate(format: "label == %@", "Completed native refresh 2"),
      evaluatedWith: status,
      timeout: 10,
      failureMessage: "The second physical iPhone pull was not accepted and completed by Solid."
    ) else {
      return
    }
    XCTAssertTrue(scrollView.exists)
    XCTAssertEqual(scrollView.frame, retainedFrame)

    let dispose = application.buttons[
      "Dispose Solid Native pull to refresh proof"
    ]
    guard dispose.waitForExistence(timeout: 5), dispose.isHittable else {
      XCTFail("The pull-to-refresh teardown control was not physically hittable.")
      return
    }
    dispose.tap()
    guard waitForPredicate(
      removed,
      evaluatedWith: scrollView,
      timeout: 10,
      failureMessage: "The iPhone pull-to-refresh tree survived terminal teardown."
    ) else {
      return
    }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testSecureStorageOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let readyText = "Solid Native secure storage ready"
    let removed = NSPredicate(format: "exists == false")

    func launchAndRequireReady() -> Bool {
      application.terminate()
      application.launch()
      guard application.wait(for: .runningForeground, timeout: 8) else {
        XCTFail("The secure-storage application did not launch on the iPhone.")
        return false
      }
      guard application.staticTexts[readyText].waitForExistence(timeout: 10) else {
        XCTFail("The Solid Native secure-storage proof did not mount.")
        return false
      }
      return true
    }

    func tap(_ label: String, expecting status: String) -> Bool {
      let button = application.buttons[label]
      guard button.waitForExistence(timeout: 5) else {
        XCTFail("The secure-storage control \(label) did not mount.")
        return false
      }
      let frame = button.frame
      guard !frame.isEmpty, application.frame.intersects(frame) else {
        XCTFail("The secure-storage control \(label) had no visible physical frame.")
        return false
      }
      // iOS 26 can report a visible Fabric Pressable as non-hittable while an
      // active call owns the Dynamic Island. Injecting its center coordinate
      // still exercises the ordinary UIKit/Fabric touchscreen path.
      button.coordinate(
        withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)
      ).tap()
      guard application.staticTexts[status].waitForExistence(timeout: 10) else {
        XCTFail("The secure-storage operation did not reach status: \(status)")
        return false
      }
      return true
    }

    guard launchAndRequireReady() else { return }
    guard tap(
      "Delete encrypted session proof",
      expecting: "Session proof deleted from native secure storage"
    ) else { return }
    guard tap(
      "Store encrypted session proof",
      expecting: "Session proof stored in native secure storage"
    ) else { return }

    // Destroy and recreate Hermes, the Solid owner tree, and RCTHost. A
    // successful read therefore proves the value crossed an actual process
    // boundary through the iOS Keychain rather than an in-memory adapter.
    guard launchAndRequireReady() else { return }
    guard tap(
      "Restore encrypted session proof",
      expecting: "Session proof restored from native secure storage"
    ) else { return }
    guard tap(
      "Delete encrypted session proof",
      expecting: "Session proof deleted from native secure storage"
    ) else { return }

    let ready = application.staticTexts[readyText]
    let dispose = application.buttons[
      "Dispose Solid Native secure storage proof"
    ]
    guard dispose.waitForExistence(timeout: 5) else {
      XCTFail("The secure-storage teardown control did not mount.")
      return
    }
    let disposeFrame = dispose.frame
    guard !disposeFrame.isEmpty, application.frame.intersects(disposeFrame) else {
      XCTFail("The secure-storage teardown control had no visible physical frame.")
      return
    }
    dispose.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)
    ).tap()
    guard waitForPredicate(
      removed,
      evaluatedWith: ready,
      timeout: 8,
      failureMessage: "The secure-storage surface survived terminal owner teardown."
    ) else {
      return
    }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testAppStateEventDeliveryOnPhysicalDevice() throws {
    let runtimePermissionMonitor = addUIInterruptionMonitor(
      withDescription: "Camera and notification permissions"
    ) { alert in
      let allow = alert.buttons.matching(
        NSPredicate(format: "label CONTAINS[c] %@", "Allow")
      ).firstMatch
      guard allow.exists else { return false }
      allow.tap()
      return true
    }
    defer { removeUIInterruptionMonitor(runtimePermissionMonitor) }
    let application = XCUIApplication()
    application.terminate()
    let deepLinkURL = try XCTUnwrap(
      URL(string: "dev.solidnative.e2e://navigation/physical?source=device-test")
    )
    if #available(iOS 16.4, *) {
      application.open(deepLinkURL)
    } else {
      XCUIDevice.shared.system.open(deepLinkURL)
    }
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The registered URL did not cold-launch Solid Native.")
      return
    }

    let coldStartDetail = application.staticTexts["solid-native-deep-link-detail"]
    guard coldStartDetail.waitForExistence(timeout: 5) else {
      XCTFail("The cold-start URL did not mount its native screen.")
      return
    }

    let title = application.staticTexts["solid-native-title"]
    guard title.waitForExistence(timeout: 10) else {
      XCTFail("The initial Solid Native title did not mount.")
      return
    }
    XCTAssertEqual(title.label, "Solid Native physical integration")
    let resourceProofStart = application.buttons[
      "solid-native-resource-proof-start"
    ]
    guard resourceProofStart.waitForExistence(timeout: 5),
      resourceProofStart.isHittable
    else {
      XCTFail("The intensive device proof gate was not hittable.")
      return
    }
    resourceProofStart.tap()
    // VisionCamera and Notify Kit request real OS permissions after the initial
    // Solid tree mounts. Repeated app interactions let XCTest dispatch this
    // monitor for either or both first-install prompts.
    for _ in 0..<4 {
      Thread.sleep(forTimeInterval: 1)
      application.tap()
    }
    let notificationStatus = application.staticTexts[
      "solid-native-notification-status"
    ]
    guard notificationStatus.waitForExistence(timeout: 5) else {
      XCTFail("The owner-bound notification output did not mount.")
      return
    }
    XCTAssertEqual(
      notificationStatus.label,
      "Native notification delivery observed"
    )

    let status = application.staticTexts["solid-native-status"]
    guard status.waitForExistence(timeout: 5) else {
      XCTFail("The initial Solid Native status did not mount.")
      return
    }
    XCTAssertEqual(status.label, "Background and reactivate to begin")

    let button = application.buttons["solid-native-signal-button"]
    guard button.waitForExistence(timeout: 5) else {
      XCTFail("The native signal button was not available.")
      return
    }
    XCTAssertEqual(button.label, "Run Solid signal update")
    XCTAssertTrue(button.isEnabled, "The Solid Pressable exposed disabled state.")
    XCTAssertFalse(
      button.isSelected,
      "The Solid Pressable unexpectedly exposed selected state."
    )
    let image = application.images["solid-native-image"]
    guard image.waitForExistence(timeout: 5) else {
      XCTFail("The native Image was missing from the accessibility tree.")
      return
    }
    XCTAssertEqual(image.label, "Solid Native decoded image")
    XCTAssertTrue(image.isEnabled)
    // React Native's ActivityIndicator Fabric component exposes its wrapping
    // component view as an accessibility `other`; UIActivityIndicatorView is
    // an implementation detail beneath that wrapper.
    let activityIndicator = application.otherElements[
      "solid-native-activity-indicator"
    ]
    guard activityIndicator.waitForExistence(timeout: 5) else {
      XCTFail("The native ActivityIndicator was missing from the accessibility tree.")
      return
    }
    XCTAssertEqual(activityIndicator.label, "Solid Native activity indicator")
    let applicationFrame = application.frame
    let buttonFrame = button.frame
    guard applicationFrame.width > 0, applicationFrame.height > 0,
      !buttonFrame.isEmpty
    else {
      XCTFail("The native signal button did not have a tappable frame.")
      return
    }
    let buttonCoordinate = button.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)
    )
    let initialScreenshot = XCTAttachment(screenshot: application.screenshot())
    initialScreenshot.name = "Solid Native before lifecycle"
    initialScreenshot.lifetime = .keepAlways
    add(initialScreenshot)

    XCUIDevice.shared.press(.home)
    Thread.sleep(forTimeInterval: 1)

    application.activate()
    guard application.wait(for: .runningForeground, timeout: 5) else {
      XCTFail("Solid Native did not return to the foreground.")
      return
    }

    // iOS 26 can drop the target application's accessibility descendants after
    // a background/foreground round trip. Preserve the real button-relative
    // coordinate so the runner can still inject an ordinary touchscreen tap
    // without a test-only native hook.
    Thread.sleep(forTimeInterval: 5)
    let resumedScreenshot = XCTAttachment(screenshot: application.screenshot())
    resumedScreenshot.name = "Solid Native after lifecycle"
    resumedScreenshot.lifetime = .keepAlways
    add(resumedScreenshot)
    let resumedButton = application.buttons["solid-native-signal-button"]
    if resumedButton.waitForExistence(timeout: 2), resumedButton.isHittable {
      resumedButton.tap()
    } else {
      buttonCoordinate.tap()
    }

    // The JS proof pushes a real RNSScreen into a UINavigationController and
    // then waits for a platform-owned dismissal. Accessibility descendants can
    // still be absent after the lifecycle round-trip on iOS 26, so synchronize
    // opportunistically and always inject a genuine left-edge back gesture.
    let detail = application.staticTexts["solid-native-navigation-detail"]
    _ = detail.waitForExistence(timeout: 8)
    Thread.sleep(forTimeInterval: 1)
    let detailScreenshot = XCTAttachment(screenshot: application.screenshot())
    detailScreenshot.name = "Solid Native native-stack detail"
    detailScreenshot.lifetime = .keepAlways
    add(detailScreenshot)
    let backGestureStart = application.coordinate(
      withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5)
    )
    let backGestureEnd = application.coordinate(
      withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)
    )
    backGestureStart.press(forDuration: 0.1, thenDragTo: backGestureEnd)

    Thread.sleep(forTimeInterval: 2)
    let restoredFocus = application.staticTexts["solid-native-navigation-focus"]
    let focused = NSPredicate(format: "label == %@", "Native screen focus observed")
    _ = XCTWaiter.wait(
      for: [XCTNSPredicateExpectation(predicate: focused, object: restoredFocus)],
      timeout: 5
    )
    XCUIDevice.shared.system.open(deepLinkURL)
    let deepLink = application.staticTexts["solid-native-deep-link-detail"]
    _ = deepLink.waitForExistence(timeout: 8)
    let textInput = application.textFields["solid-native-text-input"]
    guard textInput.waitForExistence(timeout: 5), textInput.isHittable else {
      XCTFail("The native TextInput was not available for physical keyboard input.")
      return
    }
    XCTAssertEqual(textInput.label, "Solid Native text input")
    XCTAssertTrue(textInput.isEnabled)
    textInput.tap()
    let softwareKeyboard = application.keyboards.firstMatch
    guard softwareKeyboard.waitForExistence(timeout: 5) else {
      XCTFail("The iOS software keyboard did not become visible after focusing TextInput.")
      return
    }
    textInput.typeText("SolidNative42")
    let textInputValue = application.staticTexts["solid-native-text-input-value"]
    let controlledValue = NSPredicate(format: "label == %@", "Solid controls Native")
    guard waitForPredicate(
      controlledValue,
      evaluatedWith: textInputValue,
      timeout: 5,
      failureMessage: "Solid did not expose the controlled TextInput replacement."
    ) else {
      return
    }
    let controlledNativeValue = NSPredicate(format: "value == %@", "Solid controls Native")
    guard waitForPredicate(
      controlledNativeValue,
      evaluatedWith: textInput,
      timeout: 5,
      failureMessage: "The native TextInput did not apply Solid's controlled replacement."
    ) else {
      return
    }
    let selectionStatus = application.staticTexts["solid-native-text-input-selection"]
    let selectionReady = NSPredicate(
      format: "label == %@", "Native TextInput controlled selection ready"
    )
    guard waitForPredicate(
      selectionReady,
      evaluatedWith: selectionStatus,
      timeout: 5,
      failureMessage: "Solid did not arm the controlled TextInput selection."
    ) else {
      return
    }
    textInput.typeText("X")
    let selectionObserved = NSPredicate(
      format: "label == %@", "Native TextInput controlled selection observed"
    )
    guard waitForPredicate(
      selectionObserved,
      evaluatedWith: selectionStatus,
      timeout: 5,
      failureMessage: "The native TextInput did not report the controlled selection insertion."
    ) else {
      return
    }
    let submitStatus = application.staticTexts["solid-native-text-input-submit"]
    let submitReady = NSPredicate(
      format: "label == %@", "Native TextInput ready for submit"
    )
    guard waitForPredicate(
      submitReady,
      evaluatedWith: submitStatus,
      timeout: 5,
      failureMessage: "Solid did not publish the TextInput submit readiness barrier."
    ) else {
      return
    }
    guard waitForPredicate(
      controlledNativeValue,
      evaluatedWith: textInput,
      timeout: 5,
      failureMessage: "The native TextInput did not restore the controlled value after insertion."
    ) else {
      return
    }
    textInput.typeText("\n")
    let submitted = NSPredicate(
      format: "label == %@", "Native TextInput submit and blur observed"
    )
    guard waitForPredicate(
      submitted,
      evaluatedWith: submitStatus,
      timeout: 5,
      failureMessage: "The native TextInput did not submit and blur."
    ) else {
      return
    }
    let keyboardHidden = NSPredicate(format: "exists == false")
    guard waitForPredicate(
      keyboardHidden,
      evaluatedWith: softwareKeyboard,
      timeout: 5,
      failureMessage: "The iOS software keyboard did not hide after TextInput submission."
    ) else {
      return
    }
    let multilineStatus = application.staticTexts[
      "solid-native-multiline-text-input-status"
    ]
    let multilineReady = NSPredicate(
      format: "label == %@", "Native multiline TextInput ready for newline"
    )
    guard waitForPredicate(
      multilineReady,
      evaluatedWith: multilineStatus,
      timeout: 5,
      failureMessage: "Solid did not mount the multiline TextInput readiness barrier."
    ) else {
      return
    }
    let multilineTextInput = application.textViews[
      "solid-native-multiline-text-input"
    ]
    guard multilineTextInput.waitForExistence(timeout: 5), multilineTextInput.isHittable else {
      XCTFail("The multiline TextInput was not available for physical keyboard input.")
      return
    }
    XCTAssertTrue(
      multilineTextInput.label.hasPrefix("Solid Native multiline text input"),
      "The multiline TextInput lost its explicit accessibility label."
    )
    XCTAssertTrue(multilineTextInput.isEnabled)
    multilineTextInput.tap()
    multilineTextInput.typeText("Solid\nNative")
    let multilineSucceeded = NSPredicate(
      format: "label == %@", "Native multiline TextInput newline observed"
    )
    guard waitForPredicate(
      multilineSucceeded,
      evaluatedWith: multilineStatus,
      timeout: 5,
      failureMessage: "The multiline TextInput did not report newline semantics."
    ) else {
      return
    }
    XCTAssertEqual(multilineTextInput.value as? String, "Solid\nNative")
    let controlledSwitch = application.switches["solid-native-switch"]
    guard controlledSwitch.waitForExistence(timeout: 5), controlledSwitch.isHittable else {
      XCTFail("The controlled native Switch was not available for physical input.")
      return
    }
    XCTAssertEqual(controlledSwitch.label, "Solid Native controlled switch")
    XCTAssertTrue(controlledSwitch.isEnabled)
    XCTAssertEqual(controlledSwitch.value as? String, "0")
    controlledSwitch.tap()
    let switchStatus = application.staticTexts["solid-native-switch-status"]
    let switchSucceeded = NSPredicate(
      format: "label == %@", "Native controlled Switch rollback observed"
    )
    guard waitForPredicate(
      switchSucceeded,
      evaluatedWith: switchStatus,
      timeout: 5,
      failureMessage: "The native Switch did not deliver its controlled change."
    ) else {
      return
    }
    let switchRestored = NSPredicate(format: "value == %@", "0")
    guard waitForPredicate(
      switchRestored,
      evaluatedWith: controlledSwitch,
      timeout: 5,
      failureMessage: "Solid did not restore the rejected native Switch change."
    ) else {
      return
    }
    let modalPresent = application.buttons["solid-native-modal-present"]
    guard modalPresent.waitForExistence(timeout: 5), modalPresent.isHittable else {
      XCTFail("The Modal presentation handoff was not hittable.")
      return
    }
    XCTAssertEqual(modalPresent.label, "Present Solid Native modal")
    modalPresent.tap()
    let modalTitle = application.staticTexts["solid-native-modal-title"]
    guard modalTitle.waitForExistence(timeout: 10) else {
      XCTFail("The native Modal was not presented after the controlled Switch proof.")
      return
    }
    XCTAssertEqual(modalTitle.label, "Solid Native modal is presented")
    let modalStatus = application.staticTexts["solid-native-modal-status"]
    XCTAssertTrue(modalStatus.waitForExistence(timeout: 5))
    XCTAssertEqual(modalStatus.label, "Native Modal show observed")
    let modalClose = application.buttons["solid-native-modal-close"]
    guard modalClose.waitForExistence(timeout: 5), modalClose.isHittable else {
      XCTFail("The native Modal close control was not hittable.")
      return
    }
    XCTAssertEqual(modalClose.label, "Close Solid Native modal")
    modalClose.tap()
    let modalDismissed = NSPredicate(format: "exists == false")
    guard waitForPredicate(
      modalDismissed,
      evaluatedWith: modalTitle,
      timeout: 10,
      failureMessage: "The native Modal did not dismiss after the Solid press."
    ) else {
      return
    }
    XCTAssertTrue(deepLink.exists)
    let deepLinkScreenshot = XCTAttachment(screenshot: application.screenshot())
    deepLinkScreenshot.name = "Solid Native deep-link detail"
    deepLinkScreenshot.lifetime = .keepAlways
    add(deepLinkScreenshot)

    Thread.sleep(forTimeInterval: 12)
    XCTAssertEqual(application.state, .runningForeground)
  }
}
