'use strict';

var moduleName = 'bus-events';

var xLog = require ('xcraft-core-log') (moduleName);
var xBus = require ('xcraft-core-bus');


function Events (busClient, subSocket) {
  this._busClient = busClient;
  this._sub      = subSocket;
}

/**
 * Catch all events.
 *
 * @param {Function(topic, msg)} handler
 */
Events.prototype.catchAll = function (handler) {
  this._sub.on ('message', handler);
};

/**
 * Subscribe to a topic (an event).
 *
 * @param {string} topic - Event's name.
 * @param {Function(msg)} handler - Handler to attach to this topic.
 */
Events.prototype.subscribe = function (topic, handler) {
  topic = this._busClient.topicModifier (topic);
  xLog.verb ('client added handler to topic: ' + topic);

  this._sub.subscribe (topic);

  /* register a pre-handler for deserialze object if needed */
  this._busClient.getEventsRegistry ()[topic] = function (msg) {
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
};

/**
 * Unsubscribe from a topic (event).
 *
 * @param {string} topic - Event's name.
 */
Events.prototype.unsubscribe = function (topic) {
  topic = this._busClient.topicModifier (topic);
  xLog.verb ('client removed handler on topic: ' + topic);

  this._sub.unsubscribe (topic);
  delete this._busClient.getEventsRegistry ()[topic];
};

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
Events.prototype.send = function (topic, data, serialize) {
  var originalTopic = topic;
  topic = this._busClient.topicModifier (topic);

  var notifier   = xBus.getNotifier ();
  var busMessage = this._busClient.newMessage ();

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
};

module.exports = Events;
