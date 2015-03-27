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
var orcName               = null;
var autoconnect           = false;
var connected             = false;


var topicModifier = function (topic) {
  if (/.*::.*/.test (topic)) {
    return topic;
  }

  /* Client side */
  if (orcName) {
    return orcName + '::' + topic;
  }

  /* Server side */
  var state = xBus.getCommander ().getCurrentState ();
  return state.which + '::' + topic;
};

/* broadcasted by server */
subscriptions.subscribe ('greathall::*');

/* broadcasted by bus */
subscriptions.subscribe ('gameover');

subscriptions.on ('message', function (topic, msg) {
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

  if (!eventsHandlerRegistry.hasOwnProperty (topic)) {
    return;
  }

  xLog.verb ('notification received: %s', topic);

  if (topic === 'greathall::autoconnect.finished') {
    if (!connected) {
      connected = true;
      eventsHandlerRegistry[topic] (msg);
    }
    return;
  }

  if (msg.token === token) {
    eventsHandlerRegistry[topic] (msg);
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
 * @param {function(err)} callback
 */
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
      eventsHandlerRegistry['greathall::autoconnect.finished'] = function (msg) {
        token            = msg.data.token;
        orcName          = msg.data.orcName;
        commandsRegistry = msg.data.cmdRegistry;

        xLog.info (orcName + ' is serving ' + token + ' Great Hall');

        if (orcName) {
          subscriptions.subscribe (orcName + '::*');
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

  subscriptions.connect (parseInt (busConfig.notifierPort), busConfig.host);
  commands.connect (parseInt (busConfig.commanderPort), busConfig.host);
};

exports.getToken = function () {
  return token;
};

exports.getOrcName = function () {
  return orcName;
};

exports.getCommandsRegistry = function () {
  return commandsRegistry;
};

exports.isConnected = function () {
  return connected;
};

exports.subscriptions = subscriptions;

exports.events = {
  /**
   * Subscribe to a topic (an event).
   *
   * @param {string} topic - Event's name.
   * @param {function(msg)} handler - Handler to attach to this topic.
   */
  subscribe: function (topic, handler) {
    topic = topicModifier (topic);
    xLog.verb ('client added handler to topic: ' + topic);

    subscriptions.subscribe (topic);

    /* register a pre-handler for deserialze object if needed */
    eventsHandlerRegistry[topic] = function (msg) {
      /* FIXME: it's not safe. */
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

  /**
   * Unsubscribe from a topic (event).
   *
   * @param {string} topic - Event's name.
   */
  unsubscribe: function (topic) {
    topic = topicModifier (topic);
    xLog.verb ('client removed handler on topic: ' + topic);

    subscriptions.unsubscribe (topic);
    delete eventsHandlerRegistry[topic];
  },

  /**
   * Send an event on the bus.
   *
   * The \p data can be stringified for example in the case of a simple
   * function. Of course, the function must be standalone.
   *
   * @param {string} topic - Event's name.
   * @param {Object} [data]
   * @param {boolean} [serialize] - Stringify the object.
   */
  send: function (topic, data, serialize) {
    var originalTopic = topic;
    topic = topicModifier (topic);

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

    var commander = xBus.getCommander ();
    var state     = commander.getCurrentState ();
    if (state.event === originalTopic.replace (/[^:]*::/, '')) {
      commander.statePop ();
    }

    /* Reduce noise, heartbeat is not very interesting. */
    if (topic !== 'greathall::heartbeat') {
      xLog.verb ('client send notification on topic:' + topic);
    }
  }
};

exports.command = {
  /**
   * Send a command on the bus.
   *
   * If a callback is specified, the finished topic is automatically
   * subscribed to the events bus. Then when the callback is called, the
   * topic is unsubscribed.
   *
   * @param {string} cmd - Command's name.
   * @param {Object} [data] - Map of arguments passed to the command.
   * @param {function(err, results)} [finishHandler] - Callback.
   */
  send: function (cmd, data, finishHandler) {
    if (finishHandler) {
      /* Subscribe to end command notification. */
      var finishTopic = topicModifier (cmd + '.finished');
      exports.events.subscribe (finishTopic);

      eventsHandlerRegistry[finishTopic] = function (msg) {
        exports.events.unsubscribe (finishTopic);
        finishHandler (null, msg);
      };

      xLog.verb ('finish handler registered for cmd: ' + cmd);
    }

    var busMessage = xBus.newMessage ();

    busMessage.data = data;

    xLog.verb ('client send \'%s\' command', cmd);
    commands.send (cmd, busMessage);
  }
};

/**
 * Close the connections on the buses.
 *
 * @param {function(err)} callback
 */
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
