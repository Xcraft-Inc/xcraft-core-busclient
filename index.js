'use strict';

var moduleName = 'bus-client';

var zogLog    = require ('xcraft-core-log') (moduleName);
var axon      = require ('axon');
var async     = require ('async');
var busConfig = require ('xcraft-core-etc').load ('xcraft-core-bus');


var subscriptions         = axon.socket ('sub');
var commands              = axon.socket ('push');
var eventsHandlerRegistry = {};
var token                 = 'invalid';



subscriptions.subscribe ('heartbeat');

subscriptions.on ('message', function (topic, msg) {
  if (!eventsHandlerRegistry.hasOwnProperty (topic)) {
    return;
  }

  zogLog.verb ('notification received: %s -> data:%s',
               topic,
               JSON.stringify (msg));

  if (msg.token === token) {
    eventsHandlerRegistry[topic] (msg);
  } else {
    zogLog.verb ('invalid token, event discarded');
  }
});

exports.connect = function (busToken, callbackDone) {
  /* Save bus token for checking. */
  token = busToken;

  async.parallel (
  [
    function (done) {
      subscriptions.on ('connect', function (err) { /* jshint ignore:line */
        zogLog.verb ('Bus client subscribed to notifications bus');
        done ();
      });
    },
    function (done) {
      commands.on ('connect', function (err) { /* jshint ignore:line */
        zogLog.verb ('Bus client ready to send on command bus');
        done ();
      });
    }
  ], function (err) {
    zogLog.verb ('Connected with token: ' + token);
    callbackDone (!err);
  });

  subscriptions.connect (parseInt (busConfig.notifierPort), busConfig.host);
  commands.connect (parseInt (busConfig.commanderPort), busConfig.host);
};

exports.getToken = function () {
  return token;
};

exports.events = {
  subscribe: function (topic, handler) {
    zogLog.verb ('client added handler to topic: ' + topic);

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

  send: function (topic, data, serialize) {
    var notifier   = require ('xcraft-core-bus').getNotifier ();
    var busMessage = require ('xcraft-core-bus').newMessage ();

    if (serialize) {
      busMessage.data = JSON.stringify (data, function (key, value) {
        return typeof value === 'function' ? value.toString () : value;
      });

      busMessage.serialized = true;
    } else {
      busMessage.data = data;
    }

    notifier.send (topic, busMessage);

    zogLog.verb ('client send notification on topic:' + topic);
  }
};

exports.command = {
  send: function (cmd, data, finishHandler) {
    if (finishHandler) {
      /* Subscribe to end command notification. */
      var finishTopic = cmd + '.finished';
      subscriptions.subscribe (finishTopic);
      eventsHandlerRegistry[finishTopic] = finishHandler;

      zogLog.verb ('finish handler registered for cmd: ' + cmd);
    }

    var busMessage = require ('xcraft-core-bus').newMessage ();

    busMessage.data = data;
    commands.send (cmd, busMessage);

    zogLog.verb ('client send \'%s\' command', cmd);
  }
};

exports.stop = function (callbackDone) {
  async.parallel ([
    function (callback) {
      subscriptions.on ('close', function (err) { /* jshint ignore:line */
        callback ();
      });
    },
    function (callback) {
      commands.on ('close', function (err) { /* jshint ignore:line */
        callback ();
      });
    }
  ], function (err) {
    zogLog.verb ('Stopped');
    if (callbackDone) {
      callbackDone (!err);
    }
  });

  zogLog.verb ('Stopping...');
  subscriptions.close ();
  commands.close ();
};
