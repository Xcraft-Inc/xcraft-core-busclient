'use strict';

var moduleName = 'busclient/events';

var xLog = require ('xcraft-core-log') (moduleName, null);
var xBus = require ('xcraft-core-bus');

function Events (busClient, subSocket) {
  this._busClient = busClient;
  this._sub = subSocket;
  this._prevTopic = '';
  this._handlers = {};
}

/**
 * Catch all events.
 *
 * @param {function(topic, msg)} handler
 */
Events.prototype.catchAll = function (handler) {
  this._sub.on ('message', handler);
};

/**
 * Subscribe to a topic, an event.
 *
 * @param {string} topic - Event's name.
 * @param {function(msg)} handler - Handler to attach to this topic.
 */
Events.prototype.subscribe = function (topic, handler) {
  if (!/.*::.*/.test (topic)) {
    xLog.err (new Error ().stack);
    throw new Error ('namespace missing');
  }

  xLog.verb ('client inserting handler to topic: ' + topic);

  const id = Symbol ();

  if (this._handlers[topic]) {
    this._handlers[topic][id] = handler;
  }

  const unsubscribe = () => {
    delete this._handlers[topic][id];
    if (Object.getOwnPropertySymbols (this._handlers[topic]).length === 0) {
      this.unsubscribeAll (topic);
    }
  };

  if (this._handlers[topic]) {
    return unsubscribe;
  }

  this._handlers[topic] = {};
  this._handlers[topic][id] = handler;
  this._sub.subscribe (topic);

  /* register a pre-handler for deserialize object if needed */
  const eventsRegistry = this._busClient.getEventsRegistry ();
  eventsRegistry[topic] = msg => {
    /* FIXME: it's not safe. */
    if (msg.serialized) {
      msg.data = JSON.parse (msg.data, function (key, value) {
        if (
          value &&
          typeof value === 'string' &&
          value.substr (0, 8) === 'function'
        ) {
          var startBody = value.indexOf ('{') + 1;
          var endBody = value.lastIndexOf ('}');
          var startArgs = value.indexOf ('(') + 1;
          var endArgs = value.indexOf (')');

          return new Function (
            value.substring (startArgs, endArgs) /* jshint ignore:line */,
            value.substring (startBody, endBody)
          );
        }

        return value;
      });
    }

    /* finally call user code (with or without deserialized data) */
    Object.getOwnPropertySymbols (this._handlers[topic])
      .map (id => this._handlers[topic][id])
      .forEach (handler => handler (msg));
  };

  return unsubscribe;
};

/**
 * Unsubscribe from a topic, event.
 *
 * @param {string} topic - Event's name.
 */
Events.prototype.unsubscribeAll = function (topic) {
  if (!/.*::.*/.test (topic)) {
    xLog.err (new Error ().stack);
    throw new Error ('namespace missing');
  }

  xLog.verb ('client removing handler on topic: ' + topic);

  const eventsRegistry = this._busClient.getEventsRegistry ();

  this._sub.unsubscribe (topic);
  delete eventsRegistry[topic];
  delete this._handlers[topic];
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
  if (!/.*::.*/.test (topic)) {
    const err = 'namespace missing';
    xLog.err (err.stack);
    throw new Error (err);
  }
  const which = topic.replace (/::.*/, '');

  var notifier = xBus.getNotifier ();
  var busMessage = this._busClient.newMessage (which);

  if (serialize) {
    busMessage.data = JSON.stringify (data, function (key, value) {
      return typeof value === 'function' ? value.toString () : value;
    });

    busMessage.serialized = true;
  } else {
    busMessage.data = data;
  }

  notifier.send (topic, busMessage);

  /* Reduce noise... */
  if (topic !== this._prevTopic) {
    xLog.verb ('client send notification(s) on topic:' + topic);
    this._prevTopic = topic;
  }
};

Events.prototype.status = {
  succeeded: 1,
  failed: 2,
  canceled: 3,
};

module.exports = Events;
