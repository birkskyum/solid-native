package dev.solidnative.e2e

import android.app.Activity
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.net.Uri
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SolidNativeTabsAppearancePhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testNativeTabsAppearanceCrossesFabric() {
    val activity = launchApplication(NATIVE_TABS_DEEP_LINK_URL)
    val bottomNavigation = waitForLoadedBottomNavigation(activity)

    instrumentation.runOnMainSync {
      assertTrue(
          "The Android tabs host did not mount a Material BottomNavigationView.",
          bottomNavigation.width > 0 && bottomNavigation.height > 0,
      )
      val menu =
          bottomNavigation.javaClass.getMethod("getMenu").invoke(bottomNavigation)
              as? android.view.Menu
      assertEquals("The native Android tab bar did not expose both tabs.", 2, menu?.size())
      assertTrue("The URI-backed native Home tab icon was not installed.", menu?.getItem(0)?.icon != null)
      assertTrue(
          "The native Settings tab drawable was not installed.",
          menu?.getItem(1)?.icon != null,
      )

      val itemTextColor =
          bottomNavigation.javaClass.getMethod("getItemTextColor").invoke(bottomNavigation)
              as? ColorStateList
      val itemIconTint =
          bottomNavigation.javaClass.getMethod("getItemIconTintList").invoke(bottomNavigation)
              as? ColorStateList
      val itemRippleColor =
          bottomNavigation.javaClass.getMethod("getItemRippleColor").invoke(bottomNavigation)
              as? ColorStateList
      val itemActiveIndicatorColor =
          bottomNavigation.javaClass
              .getMethod("getItemActiveIndicatorColor")
              .invoke(bottomNavigation) as? ColorStateList
      val selectedState =
          intArrayOf(android.R.attr.state_enabled, android.R.attr.state_selected)
      val normalState = intArrayOf(android.R.attr.state_enabled)
      assertEquals(
          "The selected native tab title color did not cross Fabric.",
          Color.parseColor(SELECTED_TITLE_COLOR),
          itemTextColor?.getColorForState(selectedState, Color.TRANSPARENT),
      )
      assertEquals(
          "The normal native tab title color did not cross Fabric.",
          Color.parseColor(NORMAL_TITLE_COLOR),
          itemTextColor?.getColorForState(normalState, Color.TRANSPARENT),
      )
      assertEquals(
          "The selected native tab icon color did not cross Fabric.",
          Color.parseColor(SELECTED_ICON_COLOR),
          itemIconTint?.getColorForState(selectedState, Color.TRANSPARENT),
      )
      assertEquals(
          "The normal native tab icon color did not cross Fabric.",
          Color.parseColor(NORMAL_ICON_COLOR),
          itemIconTint?.getColorForState(normalState, Color.TRANSPARENT),
      )
      assertEquals(
          "The native tab ripple color did not cross Fabric.",
          Color.parseColor(RIPPLE_COLOR),
          itemRippleColor?.defaultColor,
      )
      assertEquals(
          "The native tab active-indicator color did not cross Fabric.",
          Color.parseColor(ACTIVE_INDICATOR_COLOR),
          itemActiveIndicatorColor?.defaultColor,
      )
      assertEquals(
          "The native tab label visibility mode did not cross Fabric.",
          LABEL_VISIBILITY_LABELED,
          bottomNavigation.javaClass
              .getMethod("getLabelVisibilityMode")
              .invoke(bottomNavigation),
      )
      assertEquals(
          "The native tab active indicator was unexpectedly disabled.",
          true,
          bottomNavigation.javaClass
              .getMethod("isItemActiveIndicatorEnabled")
              .invoke(bottomNavigation),
      )
    }

    waitForText(activity, "$HOME_ICON_MODE_PREFIX none")
    waitForHomeIcon(bottomNavigation, expectedPresent = false)

    waitForText(activity, "$HOME_ICON_MODE_PREFIX resource")
    waitForHomeIcon(bottomNavigation, expectedPresent = true)

    waitForText(activity, "$HOME_ICON_MODE_PREFIX none")
    waitForHomeIcon(bottomNavigation, expectedPresent = false)
    SystemClock.sleep(STALE_IMAGE_CALLBACK_GUARD_MS)
    assertHomeIconState(bottomNavigation, expectedPresent = false)

    waitForText(activity, "$HOME_ICON_MODE_PREFIX resource")
    waitForHomeIcon(bottomNavigation, expectedPresent = true)
    waitForText(activity, "$HOME_ICON_MODE_PREFIX image")
    waitForHomeIcon(bottomNavigation, expectedPresent = true)

    instrumentation.runOnMainSync { activity.finish() }
    instrumentation.waitForIdleSync()
  }

  private fun launchApplication(initialURL: String): Activity {
    val appId = instrumentation.targetContext.packageName
    val launchIntent =
        Intent(Intent.ACTION_VIEW, Uri.parse(initialURL))
            .setPackage(appId)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK)
    val activity = instrumentation.startActivitySync(launchIntent)
    instrumentation.waitForIdleSync()
    return activity
  }

  private fun waitForLoadedBottomNavigation(activity: Activity): View {
    val deadline = SystemClock.uptimeMillis() + READY_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      var found: View? = null
      instrumentation.runOnMainSync {
        found =
            findAndroidView(activity.window.decorView) {
              it.javaClass.name == BOTTOM_NAVIGATION_CLASS
            }
        val menu =
            found?.javaClass?.getMethod("getMenu")?.invoke(found) as? android.view.Menu
        if (
            menu?.size() != 2 ||
                menu.getItem(0).icon == null ||
                menu.getItem(1).icon == null
        ) {
          found = null
        }
      }
      if (found != null) return checkNotNull(found)
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail(
        "The native Android tab bar and both sync/async icons did not load within ${READY_TIMEOUT_MS}ms."
    )
    throw AssertionError("unreachable")
  }

  private fun waitForText(activity: Activity, text: String) {
    val deadline = SystemClock.uptimeMillis() + READY_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      var found = false
      instrumentation.runOnMainSync {
        found =
            findAndroidView(activity.window.decorView) {
              (it as? TextView)?.text?.toString() == text
            } != null
      }
      if (found) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The Android text $text did not appear within ${READY_TIMEOUT_MS}ms.")
  }

  private fun waitForHomeIcon(bottomNavigation: View, expectedPresent: Boolean) {
    val deadline = SystemClock.uptimeMillis() + READY_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      if (homeIconIsPresent(bottomNavigation) == expectedPresent) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail(
        "The native Home tab icon did not become ${if (expectedPresent) "present" else "absent"} within ${READY_TIMEOUT_MS}ms."
    )
  }

  private fun assertHomeIconState(bottomNavigation: View, expectedPresent: Boolean) {
    assertEquals(
        "A stale asynchronous image callback changed the final Home tab icon state.",
        expectedPresent,
        homeIconIsPresent(bottomNavigation),
    )
  }

  private fun homeIconIsPresent(bottomNavigation: View): Boolean {
    var present = false
    instrumentation.runOnMainSync {
      val menu =
          bottomNavigation.javaClass.getMethod("getMenu").invoke(bottomNavigation)
              as android.view.Menu
      present = menu.getItem(0).icon != null
    }
    return present
  }

  private fun findAndroidView(view: View, predicate: (View) -> Boolean): View? {
    if (predicate(view)) return view
    if (view !is ViewGroup) return null
    for (index in 0 until view.childCount) {
      val found = findAndroidView(view.getChildAt(index), predicate)
      if (found != null) return found
    }
    return null
  }

  private companion object {
    private const val READY_TIMEOUT_MS = 15_000L
    private const val POLL_INTERVAL_MS = 25L
    private const val STALE_IMAGE_CALLBACK_GUARD_MS = 750L
    private const val NATIVE_TABS_DEEP_LINK_URL =
        "dev.solidnative.tabs://navigation/icon-ownership-proof"
    private const val BOTTOM_NAVIGATION_CLASS =
        "com.swmansion.rnscreens.gamma.tabs.container.CustomBottomNavigationView"
    private const val HOME_ICON_MODE_PREFIX = "Home tab icon source"
    private const val SELECTED_TITLE_COLOR = "#7c2d12"
    private const val NORMAL_TITLE_COLOR = "#9a3412"
    private const val SELECTED_ICON_COLOR = "#ea580c"
    private const val NORMAL_ICON_COLOR = "#c2410c"
    private const val RIPPLE_COLOR = "#7c2d12"
    private const val ACTIVE_INDICATOR_COLOR = "#fed7aa"
    private const val LABEL_VISIBILITY_LABELED = 1
  }
}
