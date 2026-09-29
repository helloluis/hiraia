package expo.modules.hiraiareaderinput

import android.content.Context
import android.os.SystemClock
import android.view.FocusFinder
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import kotlin.math.abs

class HiraiaReaderInputModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HiraiaReaderInput")
    // RN's native keyboard focus change clears TextInputState before JS onBlur.
    // Keyboard.dismiss() is then a no-op, leaving the IME over a freeform window.
    // Hide it without moving the new button focus, and don't interrupt another editor.
    AsyncFunction("dismissKeyboardAfterBlur") {
      val activity = appContext.currentActivity
      val window = activity?.window?.decorView
      if (window != null && window.findFocus()?.onCheckIsTextEditor() != true) {
        val input = window.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        input.hideSoftInputFromWindow(window.windowToken, 0)
      }
      Unit
    }.runOnQueue(Queues.MAIN)
    View(HiraiaReaderInputView::class) {
      Events("onNavigate")
      Prop("enabled") { view: HiraiaReaderInputView, enabled: Boolean -> view.navigationEnabled = enabled }
      Prop("blockDescendantFocus") { view: HiraiaReaderInputView, blocked: Boolean ->
        view.descendantFocusability = if (blocked) ViewGroup.FOCUS_BLOCK_DESCENDANTS else ViewGroup.FOCUS_BEFORE_DESCENDANTS
        if (blocked && view.hasFocus()) view.clearFocus()
      }
    }
  }
}

/** Input is scoped to the carousel subtree. Search fields, dialogs and quizzes keep
 * their own keys. Vertical wheels scroll card text; horizontal/Shift-wheel turns pages.
 */
class HiraiaReaderInputView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onNavigate by EventDispatcher()
  var navigationEnabled = true
  private var lastWheel = 0L
  private var lastMotion = 0L
  private var accumulated = 0f

  // React Native positions these children with Yoga. ExpoView inherits LinearLayout;
  // its default horizontal layout would move the navigation controls off-screen.
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (navigationEnabled && findFocus() !is EditText && !event.isCtrlPressed && !event.isAltPressed && !event.isMetaPressed) {
      // RN 0.81's clipped-element focusSearch fallback wraps back into nested card
      // ScrollViews when Tab should leave them. Use Android's ordinary window focus
      // search here, scoped to keyboard events originating inside the reader. Native
      // focus boundaries exclude unselected/speculative cards from this search.
      if (event.keyCode == KeyEvent.KEYCODE_TAB) {
        val focused = findFocus()
        val window = rootView as? ViewGroup
        if (event.action == KeyEvent.ACTION_DOWN && focused != null && window != null) {
          val direction = if (event.isShiftPressed) View.FOCUS_BACKWARD else View.FOCUS_FORWARD
          val next = FocusFinder.getInstance().findNextFocus(window, focused, direction)
          if (next != null && next !== focused && next.requestFocus(direction)) return true
        }
      }
      val direction = when (event.keyCode) {
        KeyEvent.KEYCODE_PAGE_DOWN -> 1
        KeyEvent.KEYCODE_PAGE_UP -> -1
        else -> 0
      }
      if (direction != 0) {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
          onNavigate(mapOf("direction" to direction))
        }
        return true
      }
    }
    return super.dispatchKeyEvent(event)
  }

  override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
    val shortcut = event.metaState and (KeyEvent.META_CTRL_ON or KeyEvent.META_ALT_ON or KeyEvent.META_META_ON)
    if (navigationEnabled && event.action == MotionEvent.ACTION_SCROLL && shortcut == 0) {
      val horizontal = event.getAxisValue(MotionEvent.AXIS_HSCROLL)
      val delta = if (horizontal != 0f) horizontal
        else if ((event.metaState and KeyEvent.META_SHIFT_ON) != 0) -event.getAxisValue(MotionEvent.AXIS_VSCROLL) else 0f
      if (delta != 0f) {
        val now = SystemClock.uptimeMillis()
        // Reset after input goes idle, not after the last committed page. Precision
        // trackpads emit fractions: resetting against lastWheel loses every fraction.
        if (now - lastMotion > 250) accumulated = 0f
        lastMotion = now
        accumulated += delta
        if (abs(accumulated) >= 1f && now - lastWheel >= 180) {
          onNavigate(mapOf("direction" to if (accumulated > 0) 1 else -1))
          accumulated = 0f
          lastWheel = now
        }
        return true
      }
    }
    return super.dispatchGenericMotionEvent(event)
  }
}
