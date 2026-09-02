import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import SolidNativeFabric

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  private var reactNativeDelegate: ReactNativeDelegate?
  private var reactNativeFactory: RCTReactNativeFactory?
  private var solidNativeApplication: SolidNativeFabricApplication?
  private var pendingLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?
  private var pendingLaunchURL: URL?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    var runtimeLaunchOptions = launchOptions
    if let requestURL = runtimeLaunchOptions?[.url] as? URL,
      SolidNativeDebugRequest.handle(url: requestURL)
    {
      runtimeLaunchOptions?.removeValue(forKey: .url)
    }
    let delegate = ReactNativeDelegate()
    delegate.dependencyProvider = RCTAppDependencyProvider()
    let factory = RCTReactNativeFactory(delegate: delegate)
    reactNativeDelegate = delegate
    reactNativeFactory = factory

    let window = UIWindow(frame: UIScreen.main.bounds)
    self.window = window
    let controller = UIViewController()
    controller.view.backgroundColor = .systemBackground
    window.rootViewController = controller
    window.makeKeyAndVisible()
    pendingLaunchOptions = runtimeLaunchOptions
    return true
  }

  func applicationDidBecomeActive(_ application: UIApplication) {
    startSolidApplicationIfNeeded()
  }

  func application(
    _ application: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    if SolidNativeDebugRequest.handle(url: url) {
      return true
    }
    if solidNativeApplication == nil {
      pendingLaunchURL = url
      return true
    }
    return RCTLinkingManager.application(application, open: url, options: options)
  }

  func applicationWillTerminate(_ application: UIApplication) {
    solidNativeApplication?.stop()
    solidNativeApplication = nil
  }

  private func startSolidApplicationIfNeeded() {
    guard solidNativeApplication == nil,
      let factory = reactNativeFactory,
      let containerView = window?.rootViewController?.view
    else { return }

    var launchOptions = pendingLaunchOptions ?? [:]
    if let pendingLaunchURL {
      launchOptions[.url] = pendingLaunchURL
    }
    pendingLaunchOptions = nil
    pendingLaunchURL = nil
    solidNativeApplication = SolidNativeFabricApplication.start(
      withFactory: factory,
      containerView: containerView,
      launchOptions: launchOptions.isEmpty ? nil : launchOptions
    ) { status, error in
      if let error {
        NSLog("SOLID_NATIVE_%@: %@", status.uppercased(), error.localizedDescription)
        if status.hasSuffix("-failed") {
          SolidNativeStartupFailureView.show(in: containerView, error: error)
        }
      } else {
        NSLog("SOLID_NATIVE_%@", status.uppercased())
      }
    }
  }
}

private final class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
