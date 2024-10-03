'use strict';

const moduleName = 'busclient/command';

const xBus = require('xcraft-core-bus');
const xLog = require('xcraft-core-log')(moduleName, null);

class Command {
  static #unsubList = new Map(); /* Only for _xcraftRPC messages */

  constructor(busClient, pushSocket) {
    this._busClient = busClient;
    this._push = pushSocket;

    const {appId, appArgs} = require('xcraft-core-host');
    const {tribe} = appArgs();

    this._routingKey = tribe ? `${appId}-${tribe}` : appId;

    this._push
      .on('close', (err) => this.#onNetworkChange(err))
      .on('error', (err) => this.#onNetworkChange(err))
      .on('connect', (err) => this.#onNetworkChange(err))
      .on('reconnect attempt', (err) => this.#onNetworkChange(err));
  }

  #onNetworkChange(err) {
    for (const {cmd, unsub, callback} of Command.#unsubList.values()) {
      unsub();
      if (callback) {
        callback(
          `The link with the server is lost during the command ${cmd}${
            err ? `: ${err}` : ''
          }`
        );
      }
    }
    Command.#unsubList.clear();
  }

  connectedWith() {
    return this._push.connectedWith();
  }

  newMessage(cmd, which) {
    if (!which) {
      which = this._busClient.getOrcName() || 'greathall';
    }

    return this._busClient.newMessage(cmd, which);
  }

  retry(msg) {
    return this.send(msg.topic, msg);
  }

  /**
   * Send a command on the bus.
   *
   * If a callback is specified, the finished topic is automatically
   * subscribed to the events bus. Then when the callback is called, the
   * topic is unsubscribed.
   *
   * @param {string} cmd - Command's name.
   * @param {object} data - Message or map of arguments passed to the command.
   * @param {string} which - Orc name or greathall.
   * @param {function()} [finishHandler] - Callback.
   * @param {object} options - Options like forceNested.
   * @param {object} msgContext - Message context.
   */
  send(cmd, data, which, finishHandler, options = {}, msgContext) {
    if (!which) {
      which = this._busClient.getOrcName() || 'greathall';
    }

    let busMessage = data;

    if (!data || !data._xcraftMessage) {
      busMessage = this.newMessage(cmd, which);
      busMessage.data = data;
      busMessage.originRouter = this._push.connectedWith();
    } else if (data._xcraftMessage) {
      this._busClient.patchMessage(busMessage);
    }

    if (msgContext) {
      busMessage.context = msgContext;
    }

    if (!busMessage.arp) {
      let token = xBus.getToken();
      let nodeName = this._routingKey;
      let {orcName} = busMessage;
      let nice = 0;
      let noForwarding = false;
      if (cmd === 'autoconnect') {
        orcName = busMessage.data.autoConnectToken;
        nice = busMessage.data.nice;
        noForwarding = busMessage.data.noForwarding;
        /* `token` can be empty, because it's provided by the autoconnect */
      } else if (!token) {
        token = orcName.split('@')[1];
        nodeName = 'zog';
        if (!token) {
          throw new Error(
            `this ARP entry without token is forbidden; it's seems that your client is using a forbidden orcName or you are not connected properly to the server`
          );
        }
      }
      busMessage.arp = {
        [orcName]: {token, nice, noForwarding, nodeName},
      };
      busMessage.router = this.connectedWith();
    }

    if (options && options.forceNested) {
      busMessage.isNested = true;
    }

    const isRPC = !!busMessage?.data?._xcraftRPC;

    if (finishHandler) {
      /* Subscribe to  end and error command notification. */
      const unsubscribe = this._busClient.events.subscribe(
        `${which}::${cmd}.${busMessage.id}.(error|finished)`,
        (msg) => {
          if (isRPC) {
            Command.#unsubList.delete(busMessage.id);
          }
          unsubscribe();

          /* On success */
          if (!msg.isError) {
            finishHandler(null, msg);
            return;
          }

          // Generator exception handling,
          // see https://gist.github.com/deepak/e325fa2d1a39984fd3e9
          setTimeout(() => {
            try {
              let err = {};
              if (msg.data && msg.data.message) {
                err.message = msg.data.message;
                if (msg.data.id) {
                  err.id = msg.data.id;
                }
                if (msg.data.code) {
                  err.code = msg.data.code;
                }
                if (msg.data.name) {
                  err.name = msg.data.name;
                }
                if (msg.data.stack) {
                  err.stack = msg.data.stack;
                }
                if (msg.data.info) {
                  err.info = msg.data.info;
                }
              } else {
                err.message = msg.data;
              }
              if (!err.topic) {
                err.topic = msg.topic;
              }
              if (!err.code) {
                err.code = 'XCRAFT_CMD_ERROR';
              }
              finishHandler(err);
            } catch (ex) {
              console.error(
                `Unexpected error: ${ex.stack || ex.message || ex}`
              );
            }
          }, 0);
        },
        this._push.connectedWith()
      );

      /* In the case of passive server, we must ensure to throw all exceptions
       * by calling the callbacks where appropriate like it was an .error
       * command event. Of course, the subscriptions must be removed by the way.
       */
      if (isRPC) {
        Command.#unsubList.set(busMessage.id, {
          cmd,
          unsub: unsubscribe,
          callback: finishHandler,
        });
      }

      xLog.verb('finish handler registered for cmd: ' + cmd);
    }

    xLog.verb("client send '%s' command", cmd);
    this._push.send(cmd, busMessage);
  }
}

module.exports = Command;
