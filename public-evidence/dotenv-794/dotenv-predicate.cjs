'use strict';
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require(path.join(process.cwd(), 'lib', 'main.js'));
const envPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.error('DOTENV_LOAD_ERROR:missing-fixture');
  process.exitCode = 2;
} else {
  const result = dotenv.config({path: envPath});
  if (result.error || result.parsed?.USERNAME !== 'something') {
    console.error('DOTENV_LOAD_ERROR:invalid-fixture');
    process.exitCode = 2;
  } else if (process.env.USERNAME !== 'something') {
    console.error('WORLDBISECT:FAIL:dotenv-794-username-collision');
    process.exitCode = 1;
  }
}
