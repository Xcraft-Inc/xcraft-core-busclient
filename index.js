'use strict';

var moduleName = 'bus-client';

var axon  = require ('axon');
var async = require ('async');

var xLog       = require ('xcraft-core-log') (moduleName);
var busConfig  = require ('xcraft-core-etc').load ('xcraft-core-bus');
var xBus       = require ('xcraft-core-bus');

var subSocket  = axon.socket ('sub');
var pushSocket = axon.socket ('push');

var eventsRegistry   = {};
var commandsRegistry = {};

var token       = 'invalid';
var orcName     = null;
var autoconnect = false;
var connected   = false;

var events  = require ('./lib/events.js') (subSocket, eventsRegistry);
var command = require ('./lib/command.js') (pushSocket, eventsRegistry, events);


/* broadcasted by server */
subSocket.subscribe ('greathall::*');

/* broadcasted by bus */
subSocket.subscribe ('gameover');

subSocket.on ('message', function (topic, msg) {
  if (topic === 'gameover') {
    xLog.info ('Game Over');
    connected = false;
    exports.stop ();
    return;
  }

  if (autoconnect && topic === 'greathall::heartbeat') {
    autoconnect = false;
    exports.command.send ('autoconnect');
    return;
  }

  if (!eventsRegistry.hasOwnProperty (topic)) {
    return;
  }

  xLog.verb ('notification received: %s', topic);

  if (topic === 'greathall::autoconnect.finished') {
    if (!connected) {
      connected = true;
      eventsRegistry[topic] (msg);
    }
    return;
  }

  if (msg.token === token) {
    eventsRegistry[topic] (msg);
  } else {
    xLog.verb ('invalid token, event discarded');
  }
});

/**
 * Connect the client to the buses.
 *
 * If the bus is not known, the argument can be null, then the client tries
 * to autoconnect to the server. It's a trivial mechanism, there is no
 * support for user authentication.
 *
 * @param {string} [busToken]
 * @param {Function(err)} callback
 */
exports.connect = function (busToken, callback) {
  /* Save bus token for checking. */
  async.parallel ([
    function (callback) {
      subSocket.on ('connect', function (err) {
        xLog.verb ('Bus client subscribed to notifications bus');
        callback (err);
      });
    },
    function (callback) {
      pushSocket.on ('connect', function (err) {
        xLog.verb ('Bus client ready to send on command bus');
        callback (err);
      });
    }
  ], function (err) {
    /* TODO: Explain auto-connect mecha */
    if (!busToken) {
      eventsRegistry['greathall::autoconnect.finished'] = function (msg) {
        token            = msg.data.token;
        orcName          = msg.data.orcName;
        commandsRegistry = msg.data.cmdRegistry;

        xLog.info (orcName + ' is serving ' + token + ' Great Hall');

        if (orcName) {
          subSocket.subscribe (orcName + '::*');
        }

        callback (err);
      };

      autoconnect = true;
      /* Autoconnect is sent when the server is ready (heartbeat). */
    } else {
      token = busToken;
      xLog.verb ('Connected with token: ' + token);
      callback (err);
    }
  });

  subSocket.connect (parseInt (busConfig.notifierPort), busConfig.host);
  pushSocket.connect (parseInt (busConfig.commanderPort), busConfig.host);
};

/**
 * Close the connections on the buses.
 *
 * @param {Function(err)} callback
 */
exports.stop = function (callback) {
  async.parallel ([
    function (callback) {
      subSocket.on ('close', callback);
    },
    function (callback) {
      pushSocket.on ('close', callback);
    }
  ], function (err) {
    xLog.verb ('Stopped');
    if (callback) {
      callback (err);
    }
  });

  xLog.verb ('Stopping...');
  subSocket.close ();
  pushSocket.close ();
};

exports.getToken = function () {
  return token;
};

exports.getOrcName = function () {
  return orcName;
};

exports.getStateWhich = function () {
  /* Client side */
  if (orcName) {
    return orcName;
  }

  /* Server side */
  var commander = xBus.getCommander ();
  if (commander.hasOwnProperty ('getCurrentState')) {
    var state = commander.getCurrentState ();
    return state.which;
  }

  return null;
};

exports.getCommandsRegistry = function () {
  return commandsRegistry;
};

exports.isConnected = function () {
  return connected;
};

exports.subscriptions = subSocket;

exports.events  = events;
exports.command = command;
