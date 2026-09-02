import type { Element as SolidElement } from "solid-js";

import type { NativeNode } from "./native-root.js";

export namespace JSX {
  export type Element = SolidElement | NativeNode | ArrayElement;
  export interface ArrayElement extends Array<Element> {}
  export interface ElementChildrenAttribute {
    children: {};
  }
  export interface IntrinsicElements {
    [name: string]: Record<string, unknown>;
  }
}
