'use strict';

var moduleName = 'bus-client';

var axon  = require ('axon');
var async = require ('async');

var xLog      = require ('xcraft-core-log') (moduleName);
var busConfig = require ('xcraft-core-etc').load ('xcraft-core-bus');
var xBus      = require ('xcraft-core-bus');
var xUtils    = require ('xcraft-core-utils');


function BusClient () {
  var self = this;

  self._subSocket  = axon.socket ('sub');
  self._pushSocket = axon.socket ('push');

  self._eventsRegistry   = {};
  self._commandsRegistry = {};

  self._token       = 'invalid';
  self._orcName     = null;
  self._autoconnect = false;
  self._connected   = false;

  self.subscriptions = self._subSocket;

  var Events = require ('./lib/events.js');
  self.events = new Events (self, self._subSocket);

  var Command = require ('./lib/command.js');
  self.command = new Command (self, self._pushSocket);

  var autoConnectToken = '';

  self._subSocket.subscribe ('greathall::*'); /* broadcasted by server */
  self._subSocket.subscribe ('gameover');     /* broadcasted by bus */

  self._subSocket.on ('message', function (topic, msg) {
    if (topic === 'gameover') {
      xLog.info ('Game Over');
      self._connected = false;
      self.stop ();
      return;
    }

    if (self._autoconnect && topic === 'greathall::heartbeat') {
      self._autoconnect = false;
      xUtils.generateToken (function (err, generatedToken) {
        if (err) {
          xLog.err (err);
          return;
        }
        autoConnectToken = generatedToken;
        self.command.send ('autoconnect', autoConnectToken);
      });

      return;
    }

    if (!self._eventsRegistry.hasOwnProperty (topic)) {
      return;
    }

    xLog.verb ('notification received: %s', topic);

    if (topic === 'greathall::autoconnect.finished') {
      if (!self._connected && msg.data.autoConnectToken === autoConnectToken) {
        self._connected = true;
        self._eventsRegistry[topic] (msg);
      }
      return;
    }

    if (msg.token === self._token) {
      self._eventsRegistry[topic] (msg);
    } else {
      xLog.verb ('invalid token, event discarded');
    }
  });
}

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
BusClient.prototype.connect = function (busToken, callback) {
  var self = this;

  /* Save bus token for checking. */
  async.parallel ([
    function (callback) {
      self._subSocket.on ('connect', function (err) {
        xLog.verb ('Bus client subscribed to notifications bus');
        callback (err);
      });
    },
    function (callback) {
      self._pushSocket.on ('connect', function (err) {
        xLog.verb ('Bus client ready to send on command bus');
        callback (err);
      });
    }
  ], function (err) {
    /* TODO: Explain auto-connect mecha */
    if (!busToken) {
      self._eventsRegistry['greathall::autoconnect.finished'] = function (msg) {
        self._token            = msg.data.token;
        self._orcName          = msg.data.orcName;
        self._commandsRegistry = msg.data.cmdRegistry;

        xLog.info (self._orcName + ' is serving ' + self._token + ' Great Hall');

        if (self._orcName) {
          self._subSocket.subscribe (self._orcName + '::*');
        }

        callback (err);
      };

      self._autoconnect = true;
      /* Autoconnect is sent when the server is ready (heartbeat). */
    } else {
      self._token = busToken;
      xLog.verb ('Connected with token: ' + self._token);
      callback (err);
    }
  });

  self._subSocket.connect (parseInt (busConfig.notifierPort), busConfig.host);
  self._pushSocket.connect (parseInt (busConfig.commanderPort), busConfig.host);
};

/**
 * Close the connections on the buses.
 *
 * @param {Function(err)} callback
 */
BusClient.prototype.stop = function (callback) {
  var self = this;

  async.parallel ([
    function (callback) {
      self._subSocket.on ('close', callback);
    },
    function (callback) {
      self._pushSocket.on ('close', callback);
    }
  ], function (err) {
    xLog.verb ('Stopped');
    if (callback) {
      callback (err);
    }
  });

  xLog.verb ('Stopping...');
  self._subSocket.close ();
  self._pushSocket.close ();
};

BusClient.prototype.getToken = function () {
  return this._token;
};

BusClient.prototype.getOrcName = function () {
  return this._orcName;
};

BusClient.prototype.getStateWhich = function () {
  /* Client side */
  if (this._orcName) {
    return this._orcName;
  }

  /* Server side */
  var commander = xBus.getCommander ();
  if (commander.hasOwnProperty ('getCurrentState')) {
    var state = commander.getCurrentState ();
    return state.which;
  }

  return null;
};

BusClient.prototype.getEventsRegistry = function () {
  return this._eventsRegistry;
};

BusClient.prototype.getCommandsRegistry = function () {
  return this._commandsRegistry;
};

BusClient.prototype.isConnected = function () {
  return this._connected;
};

BusClient.prototype.topicModifier = function (topic) {
  if (/.*::.*/.test (topic)) {
    return topic;
  }

  return this.getStateWhich () + '::' + topic;
};

module.exports = new BusClient ();
