'use strict';

/**
 * Retrieve the inquirer definition for xcraft-core-etc
 */
module.exports = [
  {
    type: 'input',
    name: 'caPath',
    message: 'path on a server certificate file (pem)',
    default: '',
  },
];
