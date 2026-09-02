import XCTest

final class SolidNativeKeyboardUITests: XCTestCase {
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

  private func waitForFrame(
    _ element: XCUIElement,
    timeout: TimeInterval,
    failureMessage: String,
    predicate: (CGRect) -> Bool,
    file: StaticString = #filePath,
    line: UInt = #line
  ) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
      if element.exists, predicate(element.frame) {
        return true
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    } while Date() < deadline
    XCTFail(failureMessage, file: file, line: line)
    return false
  }

  func testSoftwareKeyboardAvoidanceOnPhysicalDevice() throws {
    let application = XCUIApplication()
    application.launch()

    let title = application.staticTexts["solid-native-keyboard-title"]
    guard title.waitForExistence(timeout: 10) else {
      XCTFail("The Solid Native keyboard avoidance proof did not mount.")
      return
    }

    let status = application.staticTexts["solid-native-keyboard-status"]
    let anchor = application.staticTexts["solid-native-keyboard-avoidance-anchor"]
    let textInput = application.textFields["solid-native-keyboard-input"]
    guard
      status.waitForExistence(timeout: 5),
      anchor.waitForExistence(timeout: 5),
      textInput.waitForExistence(timeout: 5),
      textInput.isHittable
    else {
      XCTFail("The keyboard avoidance controls were not physically ready.")
      return
    }
    XCTAssertEqual(status.label, "Solid Native keyboard ready")
    XCTAssertEqual(anchor.label, "Solid Native keyboard avoidance anchor")
    let initialAnchorY = anchor.frame.minY

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
      failureMessage: "Solid did not apply measured keyboard avoidance."
    ) else {
      return
    }
    guard waitForFrame(
      anchor,
      timeout: 5,
      failureMessage: "The measured avoidance spacer did not move native content above the keyboard.",
      predicate: { $0.minY <= initialAnchorY - 20 }
    ) else {
      return
    }
    XCTAssertLessThanOrEqual(anchor.frame.maxY, softwareKeyboard.frame.minY + 1)

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
    guard waitForFrame(
      anchor,
      timeout: 5,
      failureMessage: "The avoidance spacer did not restore native content after keyboard hide.",
      predicate: { abs($0.minY - initialAnchorY) <= 3 }
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
      failureMessage: "The keyboard avoidance proof survived terminal owner teardown."
    ) else {
      return
    }
    XCTAssertEqual(application.state, .runningForeground)
  }

  func testFocusedFieldScrollOnPhysicalDevice() throws {
    let application = XCUIApplication()
    application.launch()

    let title = application.staticTexts["solid-native-keyboard-scroll-title"]
    guard title.waitForExistence(timeout: 10) else {
      XCTFail("The Solid Native focused-scroll proof did not mount.")
      return
    }
    let status = application.staticTexts["solid-native-keyboard-scroll-status"]
    let firstInput = application.textFields["solid-native-keyboard-scroll-input-first"]
    let secondInput = application.textFields["solid-native-keyboard-scroll-input-second"]
    guard
      status.waitForExistence(timeout: 5),
      firstInput.waitForExistence(timeout: 5),
      secondInput.waitForExistence(timeout: 5),
      firstInput.isHittable
    else {
      XCTFail("The focused-scroll controls were not physically ready.")
      return
    }
    XCTAssertEqual(status.label, "Solid Native focused scroll ready")
    let initialInputY = firstInput.frame.minY

    firstInput.tap()
    let softwareKeyboard = application.keyboards.firstMatch
    guard softwareKeyboard.waitForExistence(timeout: 5) else {
      XCTFail("The iOS software keyboard did not appear after native focus.")
      return
    }
    let visible = NSPredicate(
      format: "label == %@", "Solid Native focused field visible above keyboard"
    )
    guard waitForPredicate(
      visible,
      evaluatedWith: status,
      timeout: 5,
      failureMessage: "Solid did not complete automatic focused-field scrolling."
    ) else {
      return
    }
    guard waitForFrame(
      firstInput,
      timeout: 5,
      failureMessage: "The focused native editor did not move inside the visible viewport.",
      predicate: { $0.minY <= initialInputY - 20 }
    ) else {
      return
    }
    XCTAssertLessThanOrEqual(firstInput.frame.maxY, softwareKeyboard.frame.minY - 15)

    firstInput.typeText("SolidNativeFirst42")
    firstInput.typeText("\n")
    let traversed = NSPredicate(
      format: "label == %@",
      "Solid Native next field focused above keyboard"
    )
    guard waitForPredicate(
      traversed,
      evaluatedWith: status,
      timeout: 5,
      failureMessage: "Solid did not traverse to and reveal the second native editor."
    ) else {
      return
    }
    XCTAssertTrue(softwareKeyboard.exists)
    XCTAssertTrue(secondInput.isHittable)
    XCTAssertLessThanOrEqual(secondInput.frame.maxY, softwareKeyboard.frame.minY - 15)

    // Typing without tapping proves that the focus command selected this
    // native editor while preserving the software keyboard.
    secondInput.typeText("SolidNativeSecond42")
    secondInput.typeText("\n")
    let hidden = NSPredicate(format: "exists == false")
    guard waitForPredicate(
      hidden,
      evaluatedWith: softwareKeyboard,
      timeout: 5,
      failureMessage: "The iOS software keyboard did not hide after focused-scroll submit."
    ) else {
      return
    }
    let succeeded = NSPredicate(
      format: "label == %@",
      "Solid Native focus traversal submit and hide observed"
    )
    guard waitForPredicate(
      succeeded,
      evaluatedWith: status,
      timeout: 5,
      failureMessage: "Solid did not observe the focused-scroll keyboard lifecycle."
    ) else {
      return
    }

    let dispose = application.buttons["Dispose Solid Native focused scroll proof"]
    guard dispose.waitForExistence(timeout: 5), dispose.isHittable else {
      XCTFail("The focused-scroll teardown control was not hittable.")
      return
    }
    dispose.tap()
    guard waitForPredicate(
      hidden,
      evaluatedWith: status,
      timeout: 5,
      failureMessage: "The focused-scroll proof survived terminal owner teardown."
    ) else {
      return
    }
    XCTAssertEqual(application.state, .runningForeground)
  }
}
