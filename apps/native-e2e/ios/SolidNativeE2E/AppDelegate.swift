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
  private var isReactControl = false
  private var isClipboardSourceProof = false
  private var allowsBundledDevelopmentReload = false

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
    NSLog(
      "SOLID_NATIVE_APP_PROCESS_ID_%d",
      ProcessInfo.processInfo.processIdentifier
    )
    if let clipboardMode = SolidNativeClipboardSourceProof.mode(
      for: ProcessInfo.processInfo.arguments
    ) {
      isClipboardSourceProof = true
      let window = UIWindow(frame: UIScreen.main.bounds)
      self.window = window
      window.rootViewController = SolidNativeClipboardSourceProofViewController(
        mode: clipboardMode
      )
      window.makeKeyAndVisible()
      return true
    }
    if ProcessInfo.processInfo.arguments.contains("--solid-native-memory-keep-awake") {
      application.isIdleTimerDisabled = true
      NSLog("SOLID_NATIVE_MEMORY_IDLE_TIMER_DISABLED")
    }
    isReactControl =
      Bundle.main.object(forInfoDictionaryKey: "SolidNativeReactControl") as? String == "1"
    let useBundledDevelopment =
      ProcessInfo.processInfo.arguments.contains("--solid-native-use-bundled-development")
    allowsBundledDevelopmentReload =
      useBundledDevelopment
      && ProcessInfo.processInfo.arguments.contains("--solid-native-bundled-reload")
    let useDevelopmentReload =
      ProcessInfo.processInfo.arguments.contains("--solid-native-development-reload")
    if allowsBundledDevelopmentReload || useDevelopmentReload {
      // React Native 0.87 routes its JavaScript logging hook through os_log,
      // which is not consistently mirrored by `devicectl --console`. Replace
      // that sink only in the isolated reload-proof process so one settled
      // runtime produces exactly one machine-readable marker.
      RCTSetLogFunction { _, _, _, _, message in
        if let message, message.hasPrefix("SOLID_NATIVE_RELOAD_") {
          NSLog("%@", message)
        }
      }
    }
    var developmentMetroLocation: String?
    if useDevelopmentReload,
      let locationArgument = ProcessInfo.processInfo.arguments.first(
        where: { $0.hasPrefix("--solid-native-metro-location=") }
      )
    {
      let location = String(locationArgument.dropFirst("--solid-native-metro-location=".count))
      let components = URLComponents(string: "http://\(location)")
      if location.count <= 256,
        let components,
        components.host?.isEmpty == false,
        components.port != nil,
        components.user == nil,
        components.password == nil,
        components.path.isEmpty,
        components.query == nil,
        components.fragment == nil
      {
        RCTBundleURLProvider.sharedSettings().jsLocation = location
        developmentMetroLocation = location
        NSLog("SOLID_NATIVE_RELOAD_METRO_LOCATION_%@", location)
      } else {
        NSLog("SOLID_NATIVE_RELOAD_INVALID_METRO_LOCATION")
      }
    }
    let bundleRoot = useBundledDevelopment
      ? "diagnostics"
      : (useDevelopmentReload ? "dev-entry" : (isReactControl ? "control" : "index"))
    let delegate = ReactNativeDelegate(
      bundleRoot: bundleRoot,
      developmentMetroLocation: developmentMetroLocation,
      useBundledDevelopment: useBundledDevelopment
    )
    delegate.dependencyProvider = RCTAppDependencyProvider()
    let factory = RCTReactNativeFactory(delegate: delegate)
    reactNativeDelegate = delegate
    reactNativeFactory = factory

    let window = UIWindow(frame: UIScreen.main.bounds)
    self.window = window
    if isReactControl {
      factory.startReactNative(
        withModuleName: "SolidNativeReactControl",
        in: window,
        launchOptions: runtimeLaunchOptions
      )
      return true
    }

    let controller = UIViewController()
    controller.view.backgroundColor = .systemBackground
    window.rootViewController = controller
    window.makeKeyAndVisible()
    pendingLaunchOptions = runtimeLaunchOptions

    return true
  }

  func applicationDidBecomeActive(_ application: UIApplication) {
    guard !isClipboardSourceProof else { return }
    startSolidApplicationIfNeeded()
  }

  func application(
    _ application: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    if allowsBundledDevelopmentReload,
      url.scheme == Bundle.main.bundleIdentifier,
      url.host == "development",
      url.path == "/reload",
      url.query == nil,
      url.fragment == nil,
      let solidNativeApplication
    {
      solidNativeApplication.requestDevelopmentReload()
      return true
    }
#if SOLID_NATIVE_MEMORY_WARNING_PROOF
    if url.scheme == Bundle.main.bundleIdentifier,
      url.host == "memory-warning-proof",
      url.path.isEmpty,
      url.query == nil,
      url.fragment == nil
    {
      NotificationCenter.default.post(
        name: UIApplication.didReceiveMemoryWarningNotification,
        object: application
      )
      return true
    }
#endif
    if SolidNativeDebugRequest.handle(url: url) {
      return true
    }
    if !isReactControl, solidNativeApplication == nil {
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
    guard !isReactControl, solidNativeApplication == nil,
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
      } else {
        NSLog("SOLID_NATIVE_%@", status.uppercased())
      }
    }
    SolidNativeTabsPhysicalProof.start(
      window: window,
      launchURL: launchOptions[.url] as? URL
    )
  }
}

private enum SolidNativeClipboardSourceProof {
  enum Mode {
    case interactive
    case restore
  }

  static let sourceArgument = "--solid-native-clipboard-source"
  static let restoreArgument = "--solid-native-clipboard-restore"
  static let externalProof = "Private external clipboard read proof"
  static let applicationProof = "Private Solid Native clipboard write proof"

  static func mode(for arguments: [String]) -> Mode? {
    if arguments.contains(restoreArgument) {
      return .restore
    }
    return arguments.contains(sourceArgument) ? .interactive : nil
  }

  static func archiveURL() throws -> URL {
    guard
      let directory = FileManager.default.urls(
        for: .applicationSupportDirectory,
        in: .userDomainMask
      ).first
    else {
      throw failure("The helper has no application-support directory.")
    }
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )
    return directory.appendingPathComponent(
      "solid-native-clipboard-original.archive",
      isDirectory: false
    )
  }

  static func hasPendingRestoration() -> Bool {
    guard let url = try? archiveURL() else { return false }
    return FileManager.default.fileExists(atPath: url.path)
  }

  static func captureOriginalAndSeedProof() throws {
    let url = try archiveURL()
    guard !FileManager.default.fileExists(atPath: url.path) else {
      throw failure("An earlier clipboard restoration is still pending.")
    }
    let originalItems = UIPasteboard.general.items
    let archive = try NSKeyedArchiver.archivedData(
      withRootObject: originalItems,
      requiringSecureCoding: false
    )
    try archive.write(to: url, options: .atomic)
    UIPasteboard.general.string = externalProof
  }

  static func verifyApplicationProof() -> Bool {
    UIPasteboard.general.string == applicationProof
  }

  static func verifyClearProof() -> Bool {
    UIPasteboard.general.string == ""
  }

  @discardableResult
  static func restoreOriginalIfNeeded() throws -> Bool {
    let url = try archiveURL()
    guard FileManager.default.fileExists(atPath: url.path) else {
      return false
    }
    let archive = try Data(contentsOf: url)
    guard
      let originalItems = try NSKeyedUnarchiver.unarchiveTopLevelObjectWithData(
        archive
      ) as? [[String: Any]]
    else {
      throw failure("The archived clipboard payload is invalid.")
    }
    UIPasteboard.general.items = originalItems
    try FileManager.default.removeItem(at: url)
    return true
  }

  static func failure(_ message: String) -> NSError {
    NSError(
      domain: "SolidNativeClipboardSourceProof",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}

private final class SolidNativeClipboardSourceProofViewController: UIViewController {
  private let mode: SolidNativeClipboardSourceProof.Mode
  private let statusLabel = UILabel()

  init(mode: SolidNativeClipboardSourceProof.Mode) {
    self.mode = mode
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    let title = UILabel()
    title.font = .preferredFont(forTextStyle: .title2)
    title.numberOfLines = 0
    title.text = "Native clipboard source"

    statusLabel.font = .preferredFont(forTextStyle: .body)
    statusLabel.numberOfLines = 0

    let stack = UIStackView(arrangedSubviews: [title, statusLabel])
    stack.axis = .vertical
    stack.spacing = 12
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)

    switch mode {
    case .interactive:
      statusLabel.text = SolidNativeClipboardSourceProof.hasPendingRestoration()
        ? "Original clipboard restoration pending"
        : "Clipboard source ready"
      stack.addArrangedSubview(
        button(
          "Capture and seed external clipboard proof",
          action: #selector(captureAndSeed)
        )
      )
      stack.addArrangedSubview(
        button(
          "Verify Solid Native clipboard write proof",
          action: #selector(verifyApplicationWrite)
        )
      )
      stack.addArrangedSubview(
        button(
          "Verify native clipboard cleared",
          action: #selector(verifyClear)
        )
      )
      stack.addArrangedSubview(
        button(
          "Restore original clipboard",
          action: #selector(restoreOriginal)
        )
      )
    case .restore:
      restoreFromCleanup()
    }

    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
      stack.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
    ])
  }

  private func button(_ title: String, action: Selector) -> UIButton {
    let button = UIButton(type: .system)
    button.accessibilityLabel = title
    button.contentHorizontalAlignment = .leading
    button.setTitle(title, for: .normal)
    button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
    button.titleLabel?.numberOfLines = 0
    button.addTarget(self, action: action, for: .touchUpInside)
    return button
  }

  @objc private func captureAndSeed() {
    deferUntilAfterAutomationTap {
      do {
        try SolidNativeClipboardSourceProof.captureOriginalAndSeedProof()
        self.statusLabel.text = "External clipboard proof seeded"
        NSLog("SOLID_NATIVE_CLIPBOARD_SOURCE_SEEDED")
      } catch {
        self.statusLabel.text = "Clipboard source capture failed"
        NSLog("SOLID_NATIVE_CLIPBOARD_SOURCE_FAILED: %@", error.localizedDescription)
      }
    }
  }

  @objc private func verifyApplicationWrite() {
    deferUntilAfterAutomationTap {
      if SolidNativeClipboardSourceProof.verifyApplicationProof() {
        self.statusLabel.text = "Solid Native clipboard write verified"
        NSLog("SOLID_NATIVE_CLIPBOARD_SOURCE_WRITE_VERIFIED")
      } else {
        self.statusLabel.text = "Solid Native clipboard write mismatch"
        NSLog("SOLID_NATIVE_CLIPBOARD_SOURCE_FAILED: application write mismatch")
      }
    }
  }

  @objc private func verifyClear() {
    deferUntilAfterAutomationTap {
      if SolidNativeClipboardSourceProof.verifyClearProof() {
        self.statusLabel.text = "Native clipboard clear verified"
        NSLog("SOLID_NATIVE_CLIPBOARD_SOURCE_CLEAR_VERIFIED")
      } else {
        self.statusLabel.text = "Native clipboard clear mismatch"
        NSLog("SOLID_NATIVE_CLIPBOARD_SOURCE_FAILED: clear mismatch")
      }
    }
  }

  private func deferUntilAfterAutomationTap(_ operation: @escaping () -> Void) {
    statusLabel.text = "Clipboard source operation pending"
    DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: operation)
  }

  @objc private func restoreOriginal() {
    do {
      guard try SolidNativeClipboardSourceProof.restoreOriginalIfNeeded() else {
        statusLabel.text = "No clipboard restoration pending"
        return
      }
      statusLabel.text = "Original clipboard restored"
      NSLog("SOLID_NATIVE_CLIPBOARD_SOURCE_RESTORED")
    } catch {
      statusLabel.text = "Original clipboard restoration failed"
      NSLog("SOLID_NATIVE_CLIPBOARD_SOURCE_FAILED: restoration failed")
    }
  }

  private func restoreFromCleanup() {
    do {
      let restored = try SolidNativeClipboardSourceProof.restoreOriginalIfNeeded()
      statusLabel.text = restored
        ? "Original clipboard restored"
        : "No clipboard restoration pending"
      NSLog(
        restored
          ? "SOLID_NATIVE_CLIPBOARD_SOURCE_RESTORED"
          : "SOLID_NATIVE_CLIPBOARD_SOURCE_RESTORE_NOT_NEEDED"
      )
    } catch {
      statusLabel.text = "Original clipboard restoration failed"
      NSLog("SOLID_NATIVE_CLIPBOARD_SOURCE_FAILED: cleanup restoration failed")
    }
  }
}

private enum SolidNativeTabsPhysicalProof {
  private enum IconMode: String {
    case image
    case absent
    case resource
  }

  private enum Step {
    case initialImage
    case firstAbsent
    case resource
    case raceAbsent
    case stableAbsent
    case restoredResource
    case restoredImage
    case complete
  }

  private static var isRunning = false
  private static var step = Step.initialImage
  private static var deadline: CFTimeInterval = 0
  private static var stepDeadline: CFTimeInterval = 0
  private static var stableNoneSince: CFTimeInterval?

  static func start(window: UIWindow?, launchURL: URL?) {
    guard Bundle.main.bundleIdentifier == "dev.solidnative.tabs",
      launchURL?.scheme == "dev.solidnative.tabs",
      launchURL?.host == "navigation",
      launchURL?.path == "/icon-ownership-proof",
      let window,
      !isRunning
    else { return }
    isRunning = true
    step = .initialImage
    deadline = CACurrentMediaTime() + 30
    stepDeadline = CACurrentMediaTime() + 5
    stableNoneSince = nil
    schedule(window: window)
  }

  private static func schedule(window: UIWindow) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
      poll(window: window)
    }
  }

  private static func poll(window: UIWindow) {
    guard isRunning else { return }
    guard CACurrentMediaTime() < deadline else {
      fail("timed out while waiting for the complete native-tab appearance sequence")
      return
    }
    guard let tabBar = firstTabBar(in: window) else {
      schedule(window: window)
      return
    }
    guard let mode = iconMode(in: tabBar) else {
      if CACurrentMediaTime() >= stepDeadline {
        fail(
          "timed out at \(String(describing: step)); \(debugState(tabBar: tabBar, window: window))"
        )
      } else {
        schedule(window: window)
      }
      return
    }

    do {
      switch step {
      case .initialImage where mode == .image:
        try inspect(tabBar: tabBar, mode: mode, traits: window.traitCollection)
        succeed("INITIAL_IMAGE", next: .firstAbsent)
      case .firstAbsent where mode == IconMode.absent:
        try inspect(tabBar: tabBar, mode: mode, traits: window.traitCollection)
        succeed("NONE", next: .resource)
      case .resource where mode == .resource:
        try inspect(tabBar: tabBar, mode: mode, traits: window.traitCollection)
        succeed("RESOURCE", next: .raceAbsent)
      case .raceAbsent where mode == IconMode.absent:
        try inspect(tabBar: tabBar, mode: mode, traits: window.traitCollection)
        stableNoneSince = CACurrentMediaTime()
        succeed("RACE_NONE", next: .stableAbsent)
      case .stableAbsent:
        guard mode == IconMode.absent else {
          throw failure("a stale raster callback replaced the empty Home icon")
        }
        if let stableNoneSince, CACurrentMediaTime() - stableNoneSince >= 0.75 {
          try inspect(tabBar: tabBar, mode: mode, traits: window.traitCollection)
          succeed("STABLE_NONE", next: .restoredResource)
        }
      case .restoredResource where mode == .resource:
        try inspect(tabBar: tabBar, mode: mode, traits: window.traitCollection)
        succeed("RESTORED_RESOURCE", next: .restoredImage)
      case .restoredImage where mode == .image:
        try inspect(tabBar: tabBar, mode: mode, traits: window.traitCollection)
        succeed("RESTORED_IMAGE", next: .complete)
      case .complete:
        isRunning = false
      default:
        break
      }
      if CACurrentMediaTime() >= stepDeadline {
        throw failure(
          "timed out at \(String(describing: step)); \(debugState(tabBar: tabBar, window: window))"
        )
      }
    } catch {
      fail(error.localizedDescription)
      return
    }

    if isRunning {
      schedule(window: window)
    }
  }

  private static func succeed(_ marker: String, next: Step) {
    NSLog("SOLID_NATIVE_IOS_TABS_PROOF_%@_SUCCEEDED", marker)
    step = next
    stepDeadline = CACurrentMediaTime() + 2.25
    if case .complete = next {
      isRunning = false
    }
  }

  private static func fail(_ message: String) {
    NSLog("SOLID_NATIVE_IOS_TABS_APPEARANCE_FAILED %@", message)
    isRunning = false
  }

  private static func iconMode(in tabBar: UITabBar) -> IconMode? {
    guard let items = tabBar.items, items.count == 2 else { return nil }
    let image = items[0].image
    let selectedImage = items[0].selectedImage
    if image == nil, selectedImage == nil {
      return .absent
    }
    if image?.isSymbolImage == true, selectedImage?.isSymbolImage == true {
      return .resource
    }
    if let image, let selectedImage, !image.isSymbolImage, !selectedImage.isSymbolImage,
      image.renderingMode == .alwaysTemplate,
      selectedImage.renderingMode == .alwaysTemplate
    {
      return .image
    }
    return nil
  }

  private static func debugState(tabBar: UITabBar, window: UIWindow) -> String {
    let items = tabBar.items ?? []
    let itemState = items.enumerated().map { index, item in
      "item\(index)=\(describe(image: item.image))/\(describe(image: item.selectedImage))"
    }.joined(separator: ",")
    guard let screen = firstView(in: window, className: "RNSTabsScreenComponentView", screenKey: "home")
    else { return "\(itemState); homeScreen=missing" }
    return "\(itemState); iconType=\(screen.value(forKey: "iconType") ?? "nil"); iconImageSource=\(screen.value(forKey: "iconImageSource") ?? "nil"); iconResourceName=\(screen.value(forKey: "iconResourceName") ?? "nil")"
  }

  private static func describe(image: UIImage?) -> String {
    guard let image else { return "nil" }
    if image.isSymbolImage { return "symbol" }
    return image.renderingMode == .alwaysTemplate ? "template" : "original"
  }

  private static func firstView(
    in view: UIView,
    className: String,
    screenKey: String
  ) -> UIView? {
    if NSStringFromClass(type(of: view)).hasSuffix(className),
      view.value(forKey: "screenKey") as? String == screenKey
    {
      return view
    }
    for child in view.subviews {
      if let match = firstView(in: child, className: className, screenKey: screenKey) {
        return match
      }
    }
    return nil
  }

  private static func inspect(
    tabBar: UITabBar,
    mode: IconMode,
    traits: UITraitCollection
  ) throws {
    guard Thread.isMainThread else {
      throw failure("inspection did not run on UIKit's main thread")
    }
    guard !tabBar.isHidden, tabBar.alpha > 0, tabBar.bounds.width > 0,
      tabBar.bounds.height > 0
    else {
      throw failure("the UITabBar is not visibly mounted")
    }
    guard let items = tabBar.items, items.count == 2 else {
      throw failure("the UITabBar does not contain exactly two items")
    }
    guard tabBar.selectedItem === items[0] else {
      throw failure("the Home UITabBarItem is not selected during appearance inspection")
    }
    guard items[0].accessibilityIdentifier == "solid-native-home-tab",
      items[1].accessibilityIdentifier == "solid-native-settings-tab"
    else {
      throw failure("the UITabBarItem identifiers do not match the Solid tab keys")
    }

    for (index, item) in items.enumerated() {
      guard let standard = item.standardAppearance,
        let scrollEdge = item.scrollEdgeAppearance
      else {
        throw failure("tab item \(index) is missing standard or scroll-edge appearance")
      }
      try inspect(appearance: standard, label: "item \(index) standard", traits: traits)
      try inspect(
        appearance: scrollEdge,
        label: "item \(index) scroll edge",
        traits: traits
      )
    }

    guard items[1].image?.isSymbolImage == true,
      items[1].selectedImage?.isSymbolImage == true
    else {
      throw failure("the Settings item did not retain both SF Symbol images")
    }
    switch mode {
    case .absent:
      guard items[0].image == nil, items[0].selectedImage == nil else {
        throw failure("a stale Home image survived the empty icon transaction")
      }
    case .resource:
      guard items[0].image?.isSymbolImage == true,
        items[0].selectedImage?.isSymbolImage == true
      else {
        throw failure("the Home item did not install both SF Symbol resource images")
      }
    case .image:
      guard let image = items[0].image, let selectedImage = items[0].selectedImage,
        !image.isSymbolImage, !selectedImage.isSymbolImage,
        image.renderingMode == .alwaysTemplate,
        selectedImage.renderingMode == .alwaysTemplate
      else {
        throw failure("the Home item did not install both template raster images")
      }
    }
  }

  private static func inspect(
    appearance: UITabBarAppearance,
    label: String,
    traits: UITraitCollection
  ) throws {
    try requireColor(
      appearance.backgroundColor,
      hex: 0xfff7ed,
      label: "\(label) background",
      traits: traits
    )
    guard appearance.backgroundEffect == nil else {
      throw failure("\(label) unexpectedly retained a blur effect")
    }
    try requireColor(
      appearance.shadowColor,
      hex: 0xfed7aa,
      label: "\(label) shadow",
      traits: traits
    )

    let normal = appearance.stackedLayoutAppearance.normal
    let selected = appearance.stackedLayoutAppearance.selected
    try requireColor(
      normal.titleTextAttributes[.foregroundColor] as? UIColor,
      hex: 0x9a3412,
      label: "\(label) normal title",
      traits: traits
    )
    try requireColor(
      normal.iconColor,
      hex: 0xc2410c,
      label: "\(label) normal icon",
      traits: traits
    )
    try requireColor(
      selected.titleTextAttributes[.foregroundColor] as? UIColor,
      hex: 0x7c2d12,
      label: "\(label) selected title",
      traits: traits
    )
    try requireColor(
      selected.iconColor,
      hex: 0xea580c,
      label: "\(label) selected icon",
      traits: traits
    )
    try requireColor(
      selected.badgeBackgroundColor,
      hex: 0xdc2626,
      label: "\(label) selected badge",
      traits: traits
    )
    guard let selectedFont = selected.titleTextAttributes[.font] as? UIFont,
      let traits = selectedFont.fontDescriptor.object(forKey: .traits) as? [UIFontDescriptor.TraitKey: Any],
      let weight = traits[.weight] as? NSNumber,
      weight.doubleValue > 0
    else {
      throw failure("\(label) did not apply the selected title weight")
    }
  }

  private static func requireColor(
    _ color: UIColor?,
    hex: UInt32,
    label: String,
    traits: UITraitCollection
  ) throws {
    guard let color = color?.resolvedColor(with: traits) else {
      throw failure("\(label) color is missing")
    }
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
      throw failure("\(label) color is not representable as RGB")
    }
    let expectedRed = CGFloat((hex >> 16) & 0xff) / 255
    let expectedGreen = CGFloat((hex >> 8) & 0xff) / 255
    let expectedBlue = CGFloat(hex & 0xff) / 255
    let tolerance: CGFloat = 0.002
    guard abs(red - expectedRed) <= tolerance,
      abs(green - expectedGreen) <= tolerance,
      abs(blue - expectedBlue) <= tolerance,
      abs(alpha - 1) <= tolerance
    else {
      throw failure("\(label) color does not match its configured value")
    }
  }

  private static func firstTabBar(in view: UIView) -> UITabBar? {
    if let tabBar = view as? UITabBar {
      return tabBar
    }
    for child in view.subviews {
      if let tabBar = firstTabBar(in: child) {
        return tabBar
      }
    }
    return nil
  }

  private static func failure(_ message: String) -> NSError {
    NSError(
      domain: "SolidNativeTabsPhysicalProof",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}

private final class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  private let bundleRoot: String
  private let developmentMetroLocation: String?
  private let useBundledDevelopment: Bool

  init(
    bundleRoot: String,
    developmentMetroLocation: String?,
    useBundledDevelopment: Bool
  ) {
    self.bundleRoot = bundleRoot
    self.developmentMetroLocation = developmentMetroLocation
    self.useBundledDevelopment = useBundledDevelopment
    super.init()
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    if useBundledDevelopment {
      return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    }
    if let developmentMetroLocation {
      return RCTBundleURLProvider.jsBundleURL(
        forBundleRoot: bundleRoot,
        packagerHost: developmentMetroLocation,
        enableDev: true,
        enableMinification: false,
        inlineSourceMap: false
      )
    }
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: bundleRoot)
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
