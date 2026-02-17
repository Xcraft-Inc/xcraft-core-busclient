'use strict';

const moduleName = 'busclient/events';

const xLog = require('xcraft-core-log')(moduleName, null);

class Events {
  #xBus;

  constructor(busClient, subSocket) {
    this._busClient = busClient;
    this._sub = subSocket;
    this._prevTopic = '';
    this._handlers = new Map();
  }

  #getBus() {
    if (!this.#xBus) {
      this.#xBus = require('xcraft-core-bus');
    }
    return this.#xBus;
  }

  lastPerf() {
    return this._sub.lastPerf;
  }

  connectedWith() {
    return this._sub.connectedWith();
  }

  /**
   * Catch all events.
   *
   * @param {Function} handler - Main messages handler
   * @param {boolean} proxy - Enable proxy mode (disable Xcraft serialization)
   */
  catchAll(handler, proxy = false) {
    this._sub.on('message', handler, proxy);
  }

  /**
   * Subscribe to a topic, an event.
   *
   * @param {string} topic - Event's name.
   * @param {Function} handler - Handler to attach to this topic.
   * @param {string} [backend] - Transport backend to use (or null for all).
   * @param {string} [orcName] - Subscriber orcName (internal use)
   * @param {object} [options] - Options
   * @returns {Function} unsubscribe function.
   */
  subscribe(topic, handler, backend, orcName, options) {
    if (!topic.includes('::')) {
      xLog.err(new Error().stack);
      throw new Error('namespace missing');
    }

    if (topic.includes('undefined')) {
      xLog.warn(`bad event subscription detected: ${topic}`);
    }

    xLog.verb(() => 'client inserting handler to topic: ' + topic);

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
    const topicCtx = this._sub.subscribe(topic, backend, orcName);
    const handlers = this._handlers.get(topic);

    /* register a pre-handler for deserialize object if needed */
    this._busClient.registerEvents(topicCtx, (msg) => {
      /* FIXME: it's not safe. */
      if (msg.serialized) {
        msg.data = JSON.parse(msg.data, function (key, value) {
          if (
            value &&
            typeof value === 'string' &&
            value.substring(0, 8) === 'function'
          ) {
            const startBody = value.indexOf('{') + 1;
            const endBody = value.lastIndexOf('}');
            const startArgs = value.indexOf('(') + 1;
            const endArgs = value.indexOf(')');

            return new Function(
              value.substring(startArgs, endArgs),
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
  }

  /**
   * Unsubscribe from a topic, event.
   *
   * @param {string} topic - Event's name.
   * @param {string} [backend] - Transport backend to use (or null for all).
   * @param {string} [orcName] - Subscriber orcName (internal use)
   */
  unsubscribeAll(topic, backend, orcName) {
    if (!topic.includes('::')) {
      const err = new Error('namespace missing');
      xLog.err(err.stack);
      throw err;
    }

    xLog.verb(() => 'client removing handler on topic: ' + topic);

    const topicCtx = this._sub.unsubscribe(topic, backend, orcName);
    this._busClient.unregisterEvents(topicCtx);
    this._handlers.delete(topic);
  }

  heartbeat() {
    if (!this._busClient.isServerSide()) {
      const err = new Error('only the server can send heartbeats');
      xLog.err(err.stack);
      throw err;
    }

    const topic = 'greathall::heartbeat';
    const xBus = this.#getBus();
    const notifier = xBus.getNotifier();

    notifier.send(topic);
  }

  /**
   * Send an event on the bus.
   *
   * The \p data can be stringified for example in the case of a simple
   * function. Of course, the function must be standalone.
   *
   * @param {string} topic - Event's name.
   * @param {object} [data] - Payload.
   * @param {boolean} [serialize] - Stringify the object.
   * @param {string} [routing] - Router info (ee or axon).
   * @param {object} [msgContext] - Message context.
   * @returns {boolean} true if sent
   */
  send(topic, data, serialize, routing, msgContext) {
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
    const xBus = this.#getBus();
    const notifier = xBus.getNotifier();

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

    if (msgContext) {
      busMessage.context = msgContext;
    }

    /* Reduce noise... */
    if (topic !== this._prevTopic) {
      xLog.verb(() => 'client send notification(s) on topic: ' + topic);
      this._prevTopic = topic;
    }

    const sent = notifier.send(topic, busMessage);

    if (isActivity) {
      topic += '.activity';
      busMessage = this._busClient.newMessage(topic, which);
      notifier.send(topic, busMessage);
    }

    return sent;
  }

  status = {
    succeeded: 1,
    failed: 2,
    canceled: 3,
  };
}

module.exports = Events;
