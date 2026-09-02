import XCTest

final class SolidNativeReloadUITests: XCTestCase {
  func testFrameworkFreeFabricHostOnPhysicalDevice() throws {
    let application = XCUIApplication()
    application.launchArguments = ["--solid-native-memory-keep-awake"]
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The framework-free Fabric Host application did not reach the foreground.")
      return
    }

    let title = application.staticTexts["Framework-free Fabric Host"]
    guard title.waitForExistence(timeout: 10),
      application.staticTexts["Fabric Host mounted without a framework renderer"]
      .waitForExistence(timeout: 10)
    else {
      XCTFail("The framework-free Fabric Host did not mount its initial native tree.")
      return
    }

    let update = application.buttons["Update framework-free Fabric tree"]
    guard update.waitForExistence(timeout: 5), update.isHittable else {
      XCTFail("The framework-free Fabric update control was not hittable.")
      return
    }
    update.tap()
    guard application.staticTexts["Physical press updated Fabric through NativeHost"]
      .waitForExistence(timeout: 5)
    else {
      XCTFail("The physical press did not update the framework-free Fabric tree.")
      return
    }

    let dispose = application.buttons["Dispose framework-free Fabric tree"]
    guard dispose.waitForExistence(timeout: 5), dispose.isHittable else {
      XCTFail("The framework-free Fabric disposal control was not hittable.")
      return
    }
    dispose.tap()
    let removed = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"),
      object: title
    )
    guard XCTWaiter.wait(for: [removed], timeout: 5) == .completed
    else {
      XCTFail("The framework-free Fabric tree remained mounted after disposal.")
      return
    }
    Thread.sleep(forTimeInterval: 0.25)
    application.terminate()
  }

  func testActivateBundledDevelopmentReload() throws {
    let application = XCUIApplication()
    application.launchArguments = [
      "--solid-native-use-bundled-development",
      "--solid-native-bundled-reload",
      "--solid-native-memory-keep-awake",
    ]
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The bundled iOS reload preflight did not reach the foreground.")
      return
    }
    guard application.staticTexts["Solid Native development reload"]
      .waitForExistence(timeout: 30) else {
      XCTFail("The bundled iOS reload preflight did not mount.")
      return
    }
    // Leave this keep-awake process in the foreground. The measured
    // `devicectl --terminate-existing --activate` launch replaces it directly,
    // avoiding a screen-sleep window between the preflight and measurement.
  }

  func testGrantLocalNetworkAccessForDevelopmentReload() throws {
    let metroLocation = try XCTUnwrap(
      Bundle(for: Self.self).object(
        forInfoDictionaryKey: "SolidNativeReloadMetroLocation"
      ) as? String,
      "The iOS reload runner did not inject its Metro location."
    )
    XCTAssertFalse(metroLocation.isEmpty)
    XCTAssertLessThanOrEqual(metroLocation.count, 262)

    let application = XCUIApplication()
    application.launchArguments = [
      "--solid-native-development-reload",
      "--solid-native-metro-location=\(metroLocation)",
    ]
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The iOS reload permission preflight did not reach the foreground.")
      return
    }

    let localNetworkAlert = application.alerts.firstMatch
    if localNetworkAlert.waitForExistence(timeout: 5) {
      let allow = localNetworkAlert.buttons["Allow"]
      guard allow.exists else {
        XCTFail("The iOS local-network privacy alert did not expose Allow.")
        return
      }
      allow.tap()
    }

    guard application.staticTexts["Solid Native development reload"]
      .waitForExistence(timeout: 30) else {
      XCTFail("The iOS reload permission preflight did not mount from Metro.")
      return
    }
    application.terminate()
  }
}

final class SolidNativeNetworkingUITests: XCTestCase {
  private func waitForElementWhileApplicationRuns(
    _ element: XCUIElement,
    application: XCUIApplication,
    timeout: TimeInterval
  ) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if element.exists {
        return true
      }
      if application.state != .runningForeground {
        return false
      }
      Thread.sleep(forTimeInterval: 0.25)
    }
    return element.exists
  }

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

  func testNativeNetworkingProtocolsAndOwnerTeardownOnPhysicalDevice() throws {
    let origin = try XCTUnwrap(
      Bundle(for: Self.self).object(
        forInfoDictionaryKey: "SolidNativeNetworkingOrigin"
      ) as? String,
      "The iOS networking runner did not inject its run-scoped local origin."
    )
    XCTAssertTrue(origin.hasPrefix("http://"))
    XCTAssertTrue(origin.contains(".local:"))

    var componentAllowed = CharacterSet.alphanumerics
    componentAllowed.formUnion(CharacterSet(charactersIn: "-_.!~*'()"))
    let encodedOrigin = try XCTUnwrap(
      origin.addingPercentEncoding(withAllowedCharacters: componentAllowed)
    )
    let proofURL = try XCTUnwrap(
      URL(
        string:
          "dev.solidnative.networking://networking/proof?origin=\(encodedOrigin)"
      )
    )
    let application = XCUIApplication()
    let removed = NSPredicate(format: "exists == false")

    application.terminate()
    if #available(iOS 16.4, *) {
      application.open(proofURL)
    } else {
      XCUIDevice.shared.system.open(proofURL)
    }
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The iOS networking proof did not cold-open through its launch capability.")
      return
    }

    let title = application.staticTexts["Solid Native networking ready"]
    guard title.waitForExistence(timeout: 10) else {
      XCTFail("The iOS networking proof did not mount.")
      return
    }
    let run = application.buttons["Run native networking protocol proof"]
    guard run.waitForExistence(timeout: 5), run.isHittable else {
      XCTFail("The iOS networking protocol control was not hittable.")
      return
    }
    run.tap()

    // A fresh bundle identifier can receive the one-time local-network privacy
    // prompt. Keep that system permission inside the physical proof instead of
    // requiring an unrecorded manual tap.
    let localNetworkAlert = application.alerts.firstMatch
    if localNetworkAlert.waitForExistence(timeout: 8) {
      let allow = localNetworkAlert.buttons["Allow"]
      guard allow.isHittable else {
        XCTFail("The iOS local-network Allow action was not physically hittable.")
        return
      }
      allow.tap()
    }

    let protocolComplete = application.staticTexts[
      "Networking proof complete (2 SSE events, JSON 2, failure, cancellation)"
    ]
    guard
      waitForElementWhileApplicationRuns(
        protocolComplete,
        application: application,
        timeout: 20
      )
    else {
      XCTFail(
        application.state == .runningForeground
          ? "The iOS native networking protocol sequence did not complete."
          : "The iOS native networking application terminated during the protocol sequence."
      )
      return
    }

    let startDisposal = application.buttons[
      "Start owner-disposal network request"
    ]
    guard
      startDisposal.waitForExistence(timeout: 5),
      startDisposal.isHittable
    else {
      XCTFail("The iOS owner-disposal request control was not hittable.")
      return
    }
    startDisposal.tap()
    guard application.staticTexts["Owner-disposal request active"]
      .waitForExistence(timeout: 8) else {
      XCTFail("The iOS native request did not remain active for owner disposal.")
      return
    }

    let dispose = application.buttons["Dispose active networking owner"]
    guard dispose.waitForExistence(timeout: 5), dispose.isHittable else {
      XCTFail("The iOS networking teardown control was not hittable.")
      return
    }
    dispose.tap()
    guard waitForPredicate(
      removed,
      evaluatedWith: title,
      timeout: 8,
      failureMessage: "The iOS networking surface survived terminal owner teardown."
    ) else {
      return
    }
    XCTAssertEqual(application.state, .runningForeground)
  }
}
