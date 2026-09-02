package dev.solidnative.e2e;

import android.content.Context;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.internal.featureflags.ReactNativeNewArchitectureFeatureFlagsDefaults;
import com.facebook.react.soloader.OpenSourceMergedSoMapping;
import com.facebook.react.views.view.WindowUtilKt;
import com.facebook.soloader.SoLoader;
import java.io.IOException;

/**
 * Isolated physical-test loader for React Native's Android view-recycling experiment.
 *
 * <p>React Native 0.87 does not expose custom feature flags through its generated application
 * loader. Keep this version-coupled call out of the Solid Native runtime and fail at compile time
 * when React Native changes the internal entry point.
 */
final class SolidNativeReactNativeLoader {
  private SolidNativeReactNativeLoader() {}

  static void loadWithViewRecycling(Context context) {
    try {
      SoLoader.init(context, OpenSourceMergedSoMapping.INSTANCE);
    } catch (IOException error) {
      throw new RuntimeException(error);
    }

    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      DefaultNewArchitectureEntryPoint.loadWithFeatureFlags$ReactAndroid(
          new ViewRecyclingFeatureFlags());
    }
    if (BuildConfig.IS_EDGE_TO_EDGE_ENABLED) {
      WindowUtilKt.setEdgeToEdgeFeatureFlagOn();
    }
  }

  private static final class ViewRecyclingFeatureFlags
      extends ReactNativeNewArchitectureFeatureFlagsDefaults {
    @Override
    public boolean enableViewRecycling() {
      return true;
    }
  }
}
