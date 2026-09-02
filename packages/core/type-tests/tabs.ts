import {
  TabsScreen,
  type TabsScreenAndroidIcon,
  type TabsScreenAppearance,
  type TabsScreenIcon,
  type TabsScreenIOSIcon,
  type TabsScreenScrollEdgeAppearance,
} from "@solid-native/core";
import type { NativeNode } from "@solid-native/renderer";

const appearance: TabsScreenAppearance = {
  android: {
    tabBarItemLabelVisibilityMode: "labeled",
    selected: {
      tabBarItemTitleFontColor: "#7c2d12",
      tabBarItemIconColor: "#ea580c",
    },
    tabBarItemActiveIndicatorEnabled: true,
    tabBarItemTitleFontWeight: "600",
  },
  ios: {
    stacked: {
      selected: {
        tabBarItemTitleFontWeight: "600",
        tabBarItemTitleFontStyle: "normal",
        tabBarItemTitlePositionAdjustment: { horizontal: 1, vertical: -2 },
        tabBarItemIconColor: "#ea580c",
      },
    },
    tabBarBlurEffect: "systemDefault",
  },
};

const scrollEdgeAppearance: TabsScreenScrollEdgeAppearance = {
  ios: { tabBarBackgroundColor: "transparent", tabBarBlurEffect: "none" },
};

const tabsScreen: NativeNode = TabsScreen({
  screenKey: "settings",
  standardAppearance: appearance,
  scrollEdgeAppearance,
});
void tabsScreen;

const androidImageIcon: TabsScreenAndroidIcon = {
  type: "imageSource",
  source: {
    uri: "asset:/solid-native-home.png",
    width: 24,
    height: 24,
    scale: 2,
  },
};
const iosTemplateIcon: TabsScreenIOSIcon = {
  type: "templateSource",
  source: "data:image/png;base64,iVBORw0KGgo=",
};
const portableIcon: TabsScreenIcon = {
  android: androidImageIcon,
  ios: iosTemplateIcon,
};
void portableIcon;

const invalidOpaqueImageSource: TabsScreenIcon = {
  android: {
    type: "imageSource",
    // @ts-expect-error opaque React Native require() asset IDs are not transport-safe
    source: 42,
  },
};
void invalidOpaqueImageSource;

const invalidIOSIcon: TabsScreenIOSIcon = {
  // @ts-expect-error iOS native tabs accept only the explicit supported icon kinds
  type: "bitmap",
  source: { uri: "asset:/home.png" },
};
void invalidIOSIcon;

const invalidAppearance: TabsScreenAppearance = {
  android: {
    // @ts-expect-error native label visibility is a bounded enum
    tabBarItemLabelVisibilityMode: "always",
  },
};
void invalidAppearance;

const invalidScrollEdgeAppearance: TabsScreenScrollEdgeAppearance = {
  // @ts-expect-error scroll-edge appearance is iOS-only
  android: {},
};
void invalidScrollEdgeAppearance;
