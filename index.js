'use strict';

var moduleName = 'bus-client';

var axon  = require ('axon');
var async = require ('async');

var xLog       = require ('xcraft-core-log') (moduleName);
var busConfig  = require ('xcraft-core-etc').load ('xcraft-core-bus');
var xBus       = require ('xcraft-core-bus');

var subscriptions         = axon.socket ('sub');
var commands              = axon.socket ('push');
var eventsHandlerRegistry = {};
var commandsRegistry      = {};
var token                 = 'invalid';
var autoconnect           = false;

subscriptions.subscribe ('*');

subscriptions.on ('message', function (topic, msg) {
  if (autoconnect && topic === 'heartbeat') {
    autoconnect = false;
    exports.command.send ('autoconnect');
    return;
  }

  if (!eventsHandlerRegistry.hasOwnProperty (topic)) {
    return;
  }

  xLog.verb ('notification received: %s -> data:%s',
             topic, JSON.stringify (msg));

  if (msg.token === token || topic === 'connected') {
    eventsHandlerRegistry[topic] (msg);
  } else {
    xLog.verb ('invalid token, event discarded');
  }
});

exports.connect = function (busToken, callback) {
  /* Save bus token for checking. */
  async.parallel ([
    function (callback) {
      subscriptions.on ('connect', function (err) {
        xLog.verb ('Bus client subscribed to notifications bus');
        callback (err);
      });
    },
    function (callback) {
      commands.on ('connect', function (err) {
        xLog.verb ('Bus client ready to send on command bus');
        callback (err);
      });
    }
  ], function (err) {
    // TODO: Explain auto-connect mecha
    if (!busToken) {
      eventsHandlerRegistry.connected = function (msg) {
        token            = msg.data.token;
        commandsRegistry = msg.data.cmdRegistry;
        xLog.verb ('Connected with token: ' + token);
        callback (err);
      };

      subscriptions.subscribe ('connected');
      autoconnect = true;
      /* Autoconnect is sent when the server is ready (heartbeat). */
    } else {
      token = busToken;
      xLog.verb ('Connected with token: ' + token);
      callback (err);
    }
  });

  subscriptions.connect (parseInt (busConfig.notifierPort), busConfig.host);
  commands.connect (parseInt (busConfig.commanderPort), busConfig.host);
};

exports.getToken = function () {
  return token;
};

exports.getCommandsRegistry = function () {
  return commandsRegistry;
};

exports.subscriptions = subscriptions;

exports.events = {
  subscribe: function (topic, handler) {
    xLog.verb ('client added handler to topic: ' + topic);

    subscriptions.subscribe (topic);

    /* register a pre-handler for deserialze object if needed */
    eventsHandlerRegistry[topic] = function (msg) {
      if (msg.serialized) {
        msg.data = JSON.parse (msg.data, function (key, value) {
          if (value &&
              typeof value === 'string' &&
              value.substr (0, 8) === 'function') {
            var startBody = value.indexOf ('{') + 1;
            var endBody   = value.lastIndexOf ('}');
            var startArgs = value.indexOf ('(') + 1;
            var endArgs   = value.indexOf (')');

            return new Function (value.substring (startArgs, endArgs), /* jshint ignore:line */
                                 value.substring (startBody, endBody));
          }

          return value;
        });
      }

      /* finally call user code (with or without deserialized data) */
      handler (msg);
    };
  },

  unsubscribe: function (topic) {
    xLog.verb ('client removed handler on topic: ' + topic);

    subscriptions.unsubscribe (topic);
    delete eventsHandlerRegistry[topic];
  },

  send: function (topic, data, serialize) {
    var notifier   = xBus.getNotifier ();
    var busMessage = xBus.newMessage ();

    if (serialize) {
      busMessage.data = JSON.stringify (data, function (key, value) {
        return typeof value === 'function' ? value.toString () : value;
      });

      busMessage.serialized = true;
    } else {
      busMessage.data = data;
    }

    notifier.send (topic, busMessage);

    xLog.verb ('client send notification on topic:' + topic);
  }
};

exports.command = {
  send: function (cmd, data, finishHandler) {
    if (finishHandler) {
      /* Subscribe to end command notification. */
      var finishTopic = cmd + '.finished';
      subscriptions.subscribe (finishTopic);
      eventsHandlerRegistry[finishTopic] = finishHandler;

      xLog.verb ('finish handler registered for cmd: ' + cmd);
    }

    var busMessage = xBus.newMessage ();

    busMessage.data = data;
    commands.send (cmd, busMessage);

    xLog.verb ('client send \'%s\' command', cmd);
  }
};

exports.stop = function (callback) {
  async.parallel ([
    function (callback) {
      subscriptions.on ('close', callback);
    },
    function (callback) {
      commands.on ('close', callback);
    }
  ], function (err) {
    xLog.verb ('Stopped');
    if (callback) {
      callback (err);
    }
  });

  xLog.verb ('Stopping...');
  subscriptions.close ();
  commands.close ();
};
