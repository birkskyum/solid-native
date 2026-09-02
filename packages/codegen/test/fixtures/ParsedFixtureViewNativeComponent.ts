import type { HostComponent, ViewProps } from "react-native";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";

interface NativeProps extends ViewProps {
  readonly enabled?: boolean;
}

export default codegenNativeComponent<NativeProps>(
  "ParsedFixtureView",
) as HostComponent<NativeProps>;
