import type { HostComponent, ViewProps } from "react-native";
import type { WithDefault } from "react-native/Libraries/Types/CodegenTypes";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";

export interface NativeProps extends ViewProps {
  readonly label?: WithDefault<string, "">;
}

export default codegenNativeComponent<NativeProps>(
  "SolidNativeGeneratedView",
) as HostComponent<NativeProps>;
