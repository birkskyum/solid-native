package dev.solidnative.e2e;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.TextView;

public final class SolidNativeShareCaptureActivity extends Activity {
  public static final String COMBINED_RESULT_TEXT =
      "Solid Native combined share payload verified";
  public static final String URL_ONLY_RESULT_TEXT =
      "Solid Native URL-only share payload verified";
  public static final String INVALID_RESULT_TEXT = "Solid Native share payload invalid";
  private static final String MIME_TYPE = "text/plain";
  private static final String PRIVATE_MESSAGE = "Private Solid Native sharing proof";
  private static final String PRIVATE_URL = "https://solid-native.dev/private-proof";
  private static final String PRIVATE_SUBJECT = "Private Solid Native subject";

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    String result = validateShare(getIntent());
    TextView textView = new TextView(this);
    textView.setText(result);
    textView.setContentDescription(result);
    textView.setGravity(Gravity.CENTER);
    textView.setTextSize(20f);
    setContentView(textView);
  }

  private static String validateShare(Intent intent) {
    if (!Intent.ACTION_SEND.equals(intent.getAction()) || !MIME_TYPE.equals(intent.getType())) {
      return INVALID_RESULT_TEXT;
    }
    String message = intent.getStringExtra(Intent.EXTRA_TEXT);
    String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
    if ((PRIVATE_MESSAGE + "\n" + PRIVATE_URL).equals(message)
        && PRIVATE_SUBJECT.equals(subject)) {
      return COMBINED_RESULT_TEXT;
    }
    if (PRIVATE_URL.equals(message) && !intent.hasExtra(Intent.EXTRA_SUBJECT)) {
      return URL_ONLY_RESULT_TEXT;
    }
    return INVALID_RESULT_TEXT;
  }
}
