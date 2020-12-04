'use strict';

var moduleName = 'busclient/events';

var xLog = require('xcraft-core-log')(moduleName, null);
var xBus = require('xcraft-core-bus');

function Events(busClient, subSocket) {
  this._busClient = busClient;
  this._sub = subSocket;
  this._prevTopic = '';
  this._handlers = new Map();
}

Events.prototype.connectedWith = function () {
  return this._sub.connectedWith();
};

/**
 * Catch all events.
 *
 * @param {function(topic, msg)} handler
 */
Events.prototype.catchAll = function (handler) {
  this._sub.on('message', handler);
};

/**
 * Subscribe to a topic, an event.
 *
 * @param {string} topic - Event's name.
 * @param {function(msg)} handler - Handler to attach to this topic.
 * @param {string} [backend] - Transport backend to use (or null for all).
 * @param {string} [orcName] - Subscriber orcName (internal use)
 * @return {function} unsubscribe function.
 */
Events.prototype.subscribe = function (topic, handler, backend, orcName) {
  if (!topic.includes('::')) {
    xLog.err(new Error().stack);
    throw new Error('namespace missing');
  }

  if (topic.includes('undefined')) {
    xLog.warn(`bad event subscription detected: ${topic}`);
  }

  xLog.verb('client inserting handler to topic: ' + topic);

  const id = Symbol();

  const unsubscribe = (handleReturn) => {
    if (!this._handlers.has(topic)) {
      if (!handleReturn) {
        xLog.warn(`no unsubscribe because ${topic} is no longer available`);
      }
      return false;
    }
    const handlers = this._handlers.get(topic);
    handlers.delete(id);
    if (handlers.size === 0) {
      this.unsubscribeAll(topic, backend, orcName);
    }
    return true;
  };

  if (this._handlers.has(topic)) {
    this._handlers.get(topic).set(id, handler);
    return unsubscribe;
  }

  this._handlers.set(topic, new Map([[id, handler]]));
  this._sub.subscribe(topic, backend, orcName);

  const handlers = this._handlers.get(topic);

  /* register a pre-handler for deserialize object if needed */
  this._busClient.registerEvents(topic, (msg) => {
    /* FIXME: it's not safe. */
    if (msg.serialized) {
      msg.data = JSON.parse(msg.data, function (key, value) {
        if (
          value &&
          typeof value === 'string' &&
          value.substr(0, 8) === 'function'
        ) {
          var startBody = value.indexOf('{') + 1;
          var endBody = value.lastIndexOf('}');
          var startArgs = value.indexOf('(') + 1;
          var endArgs = value.indexOf(')');

          return new Function(
            value.substring(startArgs, endArgs) /* jshint ignore:line */,
            value.substring(startBody, endBody)
          );
        }

        return value;
      });
    }

    /* finally call user code (with or without deserialized data) */
    handlers.forEach((handler) => handler(msg));
  });

  return unsubscribe;
};

/**
 * Unsubscribe from a topic, event.
 *
 * @param {string} topic - Event's name.
 * @param {string} [backend] - Transport backend to use (or null for all).
 * @param {string} [orcName] - Subscriber orcName (internal use)
 */
Events.prototype.unsubscribeAll = function (topic, backend, orcName) {
  if (!topic.includes('::')) {
    xLog.err(new Error().stack);
    throw new Error('namespace missing');
  }

  xLog.verb('client removing handler on topic: ' + topic);

  this._sub.unsubscribe(topic, backend, orcName);
  this._busClient.unregisterEvents(topic);
  this._handlers.delete(topic);
};

/**
 * Send an event on the bus.
 *
 * The \p data can be stringified for example in the case of a simple
 * function. Of course, the function must be standalone.
 *
 * @param {string} topic - Event's name.
 * @param {Object} [data] - Payload.
 * @param {boolean} [serialize] - Stringify the object.
 * @param {string} [routing] - Router info (ee or axon).
 */
Events.prototype.send = function (topic, data, serialize, routing) {
  if (!this._busClient.isServerSide()) {
    const err = new Error('only the server can send events');
    xLog.err(err.stack);
    throw err;
  }

  if (!topic.includes('::')) {
    const err = new Error('namespace missing');
    xLog.err(err.stack);
    throw err;
  }

  const which = topic.split('::', 1)[0];

  var notifier = xBus.getNotifier();

  let busMessage = data;
  if (!data || !data._xcraftMessage) {
    busMessage = this._busClient.newMessage(topic, which);

    if (serialize) {
      busMessage.data = JSON.stringify(data, (key, value) =>
        typeof value === 'function' ? value.toString() : value
      );

      busMessage.serialized = true;
    }

    busMessage.data = data;
  } else if (data._xcraftMessage) {
    this._busClient.patchMessage(busMessage);
  }

  let isActivity = false;

  if (routing) {
    busMessage.router = routing.router;
    busMessage.originRouter = routing.originRouter;
    if (routing.forwarding) {
      busMessage.forwarding = routing.forwarding;
    }
    isActivity = routing.activity;
  }

  notifier.send(topic, busMessage);

  /* Reduce noise... */
  if (topic !== this._prevTopic) {
    xLog.verb('client send notification(s) on topic:' + topic);
    this._prevTopic = topic;
  }

  if (isActivity) {
    topic += '.activity';
    busMessage = this._busClient.newMessage(topic, which);
    notifier.send(topic, busMessage);
  }
};

Events.prototype.status = {
  succeeded: 1,
  failed: 2,
  canceled: 3,
};

module.exports = Events;
