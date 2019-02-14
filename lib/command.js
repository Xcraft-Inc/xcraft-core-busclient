'use strict';

var moduleName = 'busclient/command';

const xBus = require('xcraft-core-bus');
var xLog = require('xcraft-core-log')(moduleName, null);

function Command(busClient, pushSocket) {
  this._busClient = busClient;
  this._push = pushSocket;
}

Command.prototype.connectedWith = function() {
  return this._push.connectedWith();
};

Command.prototype.newMessage = function(cmd, which) {
  if (!which) {
    which = this._busClient.getOrcName() || 'greathall';
  }

  return this._busClient.newMessage(cmd, which);
};

Command.prototype.retry = function(msg) {
  return this.send(msg.topic, msg);
};

/**
 * Send a command on the bus.
 *
 * If a callback is specified, the finished topic is automatically
 * subscribed to the events bus. Then when the callback is called, the
 * topic is unsubscribed.
 *
 * @param {string} cmd - Command's name.
 * @param {Object} data - Message or map of arguments passed to the command.
 * @param {string} which - Orc name or greathall.
 * @param {function(err, results)} [finishHandler] - Callback.
 * @param {Object} options - Options like forceNested.
 */
Command.prototype.send = function(cmd, data, which, finishHandler, options) {
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

  if (cmd === 'autoconnect' && which !== 'greathall' && !busMessage.arp) {
    busMessage.arp = {[which]: {token: xBus.getToken()}};
  }

  if (options && options.forceNested) {
    busMessage.isNested = true;
  }

  if (finishHandler) {
    /* Subscribe to  end and error command notification. */
    const unsubscribe = this._busClient.events.subscribe(
      `${which}::${cmd}.${busMessage.id}.(error|finished)`,
      msg => {
        unsubscribe();
        if (msg.isError) {
          // Generator exception handling,
          // see https://gist.github.com/deepak/e325fa2d1a39984fd3e9
          setTimeout(() => {
            try {
              let err = {};
              if (msg.data && msg.data.message) {
                err.message = msg.data.message;
                if (msg.data.code) {
                  err.code = msg.data.code;
                }
                if (msg.data.stack) {
                  err.stack = msg.data.stack;
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
              // ignore
            }
          }, 0);
        } else {
          finishHandler(null, msg);
        }
      },
      this._push.connectedWith()
    );

    xLog.verb('finish handler registered for cmd: ' + cmd);
  }

  xLog.verb("client send '%s' command", cmd);
  this._push.send(cmd, busMessage);
};

module.exports = Command;
