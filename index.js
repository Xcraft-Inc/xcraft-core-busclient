'use strict';

const moduleName = 'busclient';

const axon = require ('axon');
const uuidV4 = require ('uuid/v4');

const xLog = require ('xcraft-core-log') (moduleName, null);
const xUtils = require ('xcraft-core-utils');

const {EventEmitter} = require ('events');
const Resp = require ('./lib/resp.js');

let globalBusClient = null;

class BusClient extends EventEmitter {
  constructor (busConfig) {
    super ();

    this._busConfig = busConfig
      ? busConfig
      : require ('xcraft-core-etc') ().load ('xcraft-core-bus');

    this._subSocket = axon.socket ('sub');
    this._pushSocket = axon.socket ('push');

    this._eventsRegistry = {};
    this._commandsRegistry = {};

    this._token = 'invalid';
    this._orcName = null;
    this._autoconnect = false;
    this._connected = false;
    this._subClosed = true;
    this._pushClosed = true;

    const Events = require ('./lib/events.js');
    this.events = new Events (this, this._subSocket);

    const Command = require ('./lib/command.js');
    this.command = new Command (this, this._pushSocket);

    let autoConnectToken = '';

    this._subSocket.subscribe ('greathall::*'); /* broadcasted by server */
    this._subSocket.subscribe ('gameover'); /* broadcasted by bus */

    this._onCloseSubscribers = {};
    this._onConnectSubscribers = {};

    const onClosed = err => {
      if (!this._subClosed || !this._pushClosed) {
        return;
      }

      if (!err) {
        xLog.verb ('Stopped');
      }

      Object.keys (this._onCloseSubscribers).forEach (key =>
        this._onCloseSubscribers[key].callback (err)
      );
    };

    const onConnected = err => {
      if (this._subClosed || this._pushClosed) {
        return;
      }

      if (!err) {
        xLog.verb ('Connected');
      }

      Object.keys (this._onConnectSubscribers).forEach (key =>
        this._onConnectSubscribers[key].callback (err)
      );
    };

    const onReconnectAttempt = () => {
      xLog.verb ('Attempt a reconnect');

      this._subSocket.unsubscribe (this._orcName + '::*');

      this._connected = false;
      this._autoconnect = true;
      this._token = 'invalid';
      this._orcName = null;
      this._registerAutoconnect (() => {
        this.emit ('reconnect');
      });
    };

    this._subSocket
      .on ('close', err => {
        this._subClosed = true;
        onClosed (err);
      })
      .on ('connect', () => {
        xLog.verb ('Bus client subscribed to notifications bus');
        this._subClosed = false;
        onConnected ();
      })
      .on ('error', err => {
        this._subClosed = true;
        onClosed (err);
        onConnected (err);
      })
      .on ('reconnect attempt', onReconnectAttempt);

    this._pushSocket
      .on ('close', err => {
        this._pushClosed = true;
        onClosed (err);
      })
      .on ('connect', () => {
        xLog.verb ('Bus client ready to send on command bus');
        this._pushClosed = false;
        onConnected ();
      })
      .on ('error', err => {
        this._pushClosed = true;
        onClosed (err);
        onConnected (err);
      })
      .on ('reconnect attempt', onReconnectAttempt);

    this._subSocket.on ('message', (topic, msg) => {
      if (topic === 'gameover') {
        xLog.info ('Game Over');
        this._connected = false;
        this.stop ();
        return;
      }

      if (topic === 'greathall::bus.commands.registry') {
        this._commandsRegistry = msg.data;
        this.emit ('commands.registry');
        return;
      }

      if (this._autoconnect && topic === 'greathall::heartbeat') {
        this._autoconnect = false;

        xUtils.crypto.genToken ((err, generatedToken) => {
          if (err) {
            xLog.err (err);
            return;
          }
          autoConnectToken = generatedToken;
          this._subSocket.subscribe (
            autoConnectToken + '::autoconnect.finished'
          );
          this.command.send ('autoconnect', autoConnectToken);
        });

        return;
      }

      if (
        !this._connected &&
        topic === autoConnectToken + '::autoconnect.finished'
      ) {
        this._connected = true;
        this._subSocket.unsubscribe (
          autoConnectToken + '::autoconnect.finished'
        );
        this._eventsRegistry['autoconnect.finished'] (msg);
        delete this._eventsRegistry['autoconnect.finished'];
        return;
      }

      if (!this._eventsRegistry.hasOwnProperty (topic)) {
        return;
      }

      xLog.verb ('notification received: %s', topic);

      if (msg.token === this._token) {
        this._eventsRegistry[topic] (msg);
      } else {
        xLog.verb ('invalid token, event discarded');
      }
    });
  }

  _registerAutoconnect (callback, err) {
    this._eventsRegistry['autoconnect.finished'] = msg => {
      this._token = msg.data.token;
      this._orcName = msg.data.orcName;
      this._commandsRegistry = msg.data.cmdRegistry;

      xLog.info (this._orcName + ' is serving ' + this._token + ' Great Hall');

      if (this._orcName) {
        this._subSocket.subscribe (this._orcName + '::*');
      }

      if (callback) {
        callback (err);
      }
    };
  }

  _subscribeClose (callback) {
    const key = uuidV4 ();
    this._onCloseSubscribers[key] = {
      callback,
      unsubscribe: () => {
        delete this._onCloseSubscribers[key];
      },
    };
    return this._onCloseSubscribers[key].unsubscribe;
  }

  _subscribeConnect (callback) {
    const key = uuidV4 ();
    this._onConnectSubscribers[key] = {
      callback,
      unsubscribe: () => {
        delete this._onConnectSubscribers[key];
      },
    };
    return this._onConnectSubscribers[key].unsubscribe;
  }

  /**
   * Connect the client to the buses.
   *
   * When the busToken is null, the client tries to autoconnect to the server.
   * It's a trivial mechanism, there is no support for user authentication.
   *
   * The busToken must be passed only when BusClient is used on the server
   * side. In all other cases, the argument _must_ be null.
   *
   * @param {string} [busToken]
   * @param {function(err)} callback
   */
  connect (busToken, callback) {
    xLog.verb ('Connecting...');

    const unsubscribe = this._subscribeConnect (err => {
      unsubscribe ();

      if (err) {
        callback (err);
        return;
      }

      /* TODO: Explain auto-connect mecha */
      if (!busToken) {
        /* Autoconnect is sent when the server is ready (heartbeat). */
        this._registerAutoconnect (callback, err);
        this._autoconnect = true;
        return;
      }

      this._connected = true;
      this._token = busToken;
      xLog.verb ('Connected with token: ' + this._token);

      callback (err);
    });

    this._subSocket.connect (
      parseInt (this._busConfig.notifierPort),
      this._busConfig.host
    );
    this._pushSocket.connect (
      parseInt (this._busConfig.commanderPort),
      this._busConfig.host
    );
  }

  /**
   * Close the connections on the buses.
   *
   * @param {function(err)} callback
   */
  stop (callback) {
    xLog.verb ('Stopping...');

    const unsubscribe = this._subscribeClose (err => {
      unsubscribe ();
      if (callback) {
        callback (err);
      }
    });

    this._connected = false;
    this._subSocket.close ();
    this._pushSocket.close ();
  }

  /**
   * Return a new empty message for the commands.
   *
   * The \p isNested attribute is set when the command is called from the server
   * side but with an orc name.
   *
   * @return {object} the new message.
   */
  newMessage (which) {
    return {
      token: this.getToken (),
      orcName: which,
      timestamp: new Date ().toISOString (),
      data: {},
      isNested: !!(this.isServerSide () && which && which !== 'greathall'),
    };
  }

  isServerSide () {
    return !this._orcName;
  }

  getToken () {
    return this._token;
  }

  getOrcName () {
    return this._orcName;
  }

  getEventsRegistry () {
    return this._eventsRegistry;
  }

  getCommandsRegistry () {
    return this._commandsRegistry;
  }

  isConnected () {
    return this._connected;
  }

  newResponse () {
    return exports.newResponse.apply (this, arguments);
  }
}

exports.newResponse = function (moduleName, orcName) {
  let self = null;
  if (this instanceof BusClient) {
    self = this;
  }

  return new Resp (self, moduleName, orcName);
};

exports.initGlobal = function () {
  globalBusClient = new BusClient ();
  return globalBusClient;
};

exports.getGlobal = function () {
  return globalBusClient;
};

exports.BusClient = BusClient;
