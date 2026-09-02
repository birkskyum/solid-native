import type { Element as SolidElement } from "solid-js";

import type { NativeNode } from "@solid-native/renderer";
import type {
  ActivityIndicatorProps,
  ImageProps,
  ModalProps,
  PressableProps,
  ScreenHeaderProps,
  ScreenHeaderSubviewProps,
  ScreenProps,
  ScreenStackProps,
  ScrollViewProps,
  SwitchProps,
  TabsHostProps,
  TabsScreenProps,
  TextInputProps,
  TextProps,
  ViewProps,
} from "./index.js";

export namespace JSX {
  export type Element = SolidElement | NativeNode | ArrayElement;
  export interface ArrayElement extends Array<Element> {}
  export interface ElementChildrenAttribute {
    children: {};
  }
  export interface IntrinsicElements {
    view: ViewProps;
    text: TextProps;
    image: ImageProps;
    pressable: PressableProps;
    scrollView: ScrollViewProps;
    textInput: TextInputProps;
    activityIndicator: ActivityIndicatorProps;
    switch: SwitchProps;
    modal: ModalProps;
    screen: ScreenProps;
    screenStack: ScreenStackProps;
    screenHeader: ScreenHeaderProps;
    screenHeaderSubview: ScreenHeaderSubviewProps;
    tabsHost: TabsHostProps;
    tabsScreen: TabsScreenProps;
  }
}
