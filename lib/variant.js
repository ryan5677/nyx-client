'use strict';
/**
 * Which build this is. Edited before each `electron-builder` run to produce
 * the two artifacts:
 *   'dev'    - Admin tab reachable (code unlock in Settings), can generate/
 *              manage remote Premium grants.
 *   'public' - no way to reach Admin at all, anywhere, even via the raw
 *              settings file - main.js itself refuses to set adminUnlocked
 *              when this is 'public', not just the UI hiding the button.
 *              Premium tab still works normally.
 */
module.exports = {
  VARIANT: 'public',
};
