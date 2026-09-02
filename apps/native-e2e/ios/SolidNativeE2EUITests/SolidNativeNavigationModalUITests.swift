import XCTest

final class SolidNativeNavigationModalUITests: XCTestCase {
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

  func testStandaloneNavigationModalOnPhysicalDevice() throws {
    let application = XCUIApplication()
    let removed = NSPredicate(format: "exists == false")

    application.terminate()
    application.launch()
    guard application.wait(for: .runningForeground, timeout: 8) else {
      XCTFail("The standalone navigation-modal application did not launch.")
      return
    }

    let root = application.staticTexts["Solid Native standalone modal root"]
    guard root.waitForExistence(timeout: 10) else {
      XCTFail("The standalone modal proof did not mount its retained root route.")
      return
    }
    let open = application.buttons["Open standalone native modal"]
    guard open.waitForExistence(timeout: 5), open.isHittable else {
      XCTFail("The standalone modal presentation control was not hittable.")
      return
    }

    open.tap()
    let modalTitle = application.staticTexts["Solid Native standalone modal route"]
    guard modalTitle.waitForExistence(timeout: 8) else {
      XCTFail("NativeModalStack did not present its first UIKit modal route.")
      return
    }
    XCTAssertTrue(
      application.staticTexts["Native modal swipe dismissal blocked"]
        .waitForExistence(timeout: 5),
      "The first modal did not inherit the active platform-close blocker."
    )
    let applicationClose = application.buttons[
      "Close modal through application history"
    ]
    guard applicationClose.waitForExistence(timeout: 5), applicationClose.isHittable else {
      XCTFail("The application-controlled modal close was not hittable.")
      return
    }
    applicationClose.tap()
    guard waitForPredicate(
      removed,
      evaluatedWith: modalTitle,
      timeout: 8,
      failureMessage: "The application history pop did not dismiss its UIKit modal."
    ) else {
      return
    }
    guard application.staticTexts[
      "Application modal hidden; owner disposed exactly once"
    ].waitForExistence(timeout: 8) else {
      XCTFail("The first modal owner was not disposed after the hidden boundary.")
      return
    }
    XCTAssertTrue(root.exists, "Application modal dismissal recreated the root owner.")

    guard open.isHittable else {
      XCTFail("The retained root could not present a second modal route.")
      return
    }
    open.tap()
    guard modalTitle.waitForExistence(timeout: 8) else {
      XCTFail("NativeModalStack did not present its second UIKit modal route.")
      return
    }
    let modal = application.otherElements["solid-native-routed-modal"]
    guard modal.waitForExistence(timeout: 5), !modal.frame.isEmpty else {
      XCTFail("The routed modal did not expose physical UIKit geometry.")
      return
    }
    let dragStart = modal.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.03)
    )
    let dismissalTarget = application.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)
    )

    dragStart.press(
      forDuration: 0.15,
      thenDragTo: dismissalTarget,
      withVelocity: .fast,
      thenHoldForDuration: 0.1
    )
    guard application.staticTexts["Native modal blocked request arbitrated"]
      .waitForExistence(timeout: 8) else {
      XCTFail("The prevented UIKit gesture did not pass through NativeHistory blocker arbitration.")
      return
    }
    XCTAssertTrue(
      modalTitle.exists,
      "UIKit dismissed the modal while NativeHistory still had a close blocker."
    )
    XCTAssertTrue(
      modal.exists,
      "The blocked swipe removed its routed UIKit container."
    )
    XCTAssertEqual(application.state, .runningForeground)

    let enableSwipe = application.buttons[
      "Enable native modal swipe dismissal"
    ]
    guard enableSwipe.waitForExistence(timeout: 5), enableSwipe.isHittable else {
      XCTFail("The reactive modal dismissal control was not hittable.")
      return
    }
    enableSwipe.tap()
    guard application.staticTexts["Native modal swipe dismissal enabled"]
      .waitForExistence(timeout: 5) else {
      XCTFail("NativeModalStack did not reactively enable UIKit swipe dismissal.")
      return
    }

    dragStart.press(
      forDuration: 0.15,
      thenDragTo: dismissalTarget,
      withVelocity: .fast,
      thenHoldForDuration: 0.1
    )
    guard waitForPredicate(
      removed,
      evaluatedWith: modalTitle,
      timeout: 10,
      failureMessage: "The enabled physical UIKit swipe did not close NativeHistory."
    ) else {
      return
    }
    guard application.staticTexts[
      "Platform modal hidden; owner disposed exactly twice"
    ].waitForExistence(timeout: 8) else {
      XCTFail("The swiped modal owner was not retained through UIKit dismissal.")
      return
    }
    XCTAssertTrue(root.exists, "The native modal swipe recreated the retained root owner.")

    let dispose = application.buttons["Dispose standalone modal proof"]
    guard dispose.waitForExistence(timeout: 5), dispose.isHittable else {
      XCTFail("The standalone modal teardown control was not hittable.")
      return
    }
    dispose.tap()
    guard waitForPredicate(
      removed,
      evaluatedWith: root,
      timeout: 8,
      failureMessage: "The standalone modal surface survived terminal teardown."
    ) else {
      return
    }
    XCTAssertEqual(application.state, .runningForeground)
  }
}
