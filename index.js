'use strict';

const moduleName = 'busclient';

const axon = require ('axon');
const async = require ('async');

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

    const Events = require ('./lib/events.js');
    this.events = new Events (this, this._subSocket);

    const Command = require ('./lib/command.js');
    this.command = new Command (this, this._pushSocket);

    let autoConnectToken = '';

    this._subSocket.subscribe ('greathall::*'); /* broadcasted by server */
    this._subSocket.subscribe ('gameover'); /* broadcasted by bus */

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
  connect (busToken, callback) {
    /* Save bus token for checking. */
    async.parallel (
      [
        callback => {
          this._subSocket
            .on ('connect', () => {
              xLog.verb ('Bus client subscribed to notifications bus');
              callback ();
            })
            .on ('error', callback);
        },
        callback => {
          this._pushSocket
            .on ('connect', () => {
              xLog.verb ('Bus client ready to send on command bus');
              callback ();
            })
            .on ('error', callback);
        },
      ],
      err => {
        if (err) {
          callback (err);
          return;
        }

        /* TODO: Explain auto-connect mecha */
        if (!busToken) {
          this._eventsRegistry['autoconnect.finished'] = msg => {
            this._token = msg.data.token;
            this._orcName = msg.data.orcName;
            this._commandsRegistry = msg.data.cmdRegistry;

            xLog.info (
              this._orcName + ' is serving ' + this._token + ' Great Hall'
            );

            if (this._orcName) {
              this._subSocket.subscribe (this._orcName + '::*');
            }

            callback (err);
          };

          this._autoconnect = true;
          /* Autoconnect is sent when the server is ready (heartbeat). */
        } else {
          this._connected = true;
          this._token = busToken;
          xLog.verb ('Connected with token: ' + this._token);
          callback (err);
        }
      }
    );

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
    async.parallel (
      [
        callback => {
          this._subSocket.on ('close', callback);
        },
        callback => {
          this._pushSocket.on ('close', callback);
        },
      ],
      err => {
        xLog.verb ('Stopped');
        if (callback) {
          callback (err);
        }
      }
    );

    xLog.verb ('Stopping...');
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
