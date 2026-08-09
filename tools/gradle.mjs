// Plattformneutraler Gradle-Aufruf: gradlew.bat (Windows) bzw. ./gradlew (Unix).
// Behebt, dass "./gradlew" unter Windows-cmd nicht funktioniert und dass cmd
// gradlew.bat nicht im CWD findet (absoluter Pfad statt CWD-Suche).
// Aufruf: node tools/gradle.mjs <task>   (z.B. assembleRelease)
import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { resolve } from 'node:path';

const task = process.argv[2] || 'assembleDebug';
const isWin = platform() === 'win32';
const gradlew = resolve('android', isWin ? 'gradlew.bat' : 'gradlew');
const result = spawnSync(gradlew, [task], {
  cwd: 'android',
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
