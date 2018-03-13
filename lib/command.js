'use strict';

var moduleName = 'busclient/command';

var xLog = require('xcraft-core-log')(moduleName, null);

function Command(busClient, pushSocket) {
  this._busClient = busClient;
  this._push = pushSocket;
}

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
 */
Command.prototype.send = function(cmd, data, which, finishHandler) {
  var self = this;

  if (!which) {
    which = this._busClient.getOrcName() || 'greathall';
  }

  let stack = [];
  if (typeof cmd !== 'string') {
    stack = cmd.stack;
    cmd = cmd.cmd;
  }

  let busMessage = data;
  if (!data || !data._xcraftMessage) {
    busMessage = self.newMessage(cmd, which);
    busMessage.data = data;
  } else if (data._xcraftMessage) {
    this._busClient.patchMessage(busMessage);
  }

  if (finishHandler) {
    stack.push(cmd);
  } else if (stack.length > 0) {
    if (stack[stack.length - 1].startsWith('...incomplete...')) {
      stack.push(`...incomplete... ${cmd}`);
    } else {
      stack[stack.length - 1] = cmd;
    }
  }

  busMessage.stack = stack;

  if (finishHandler) {
    /* Subscribe to  end and error command notification. */
    const unsubscribe = self._busClient.events.subscribe(
      `${which}::${cmd}.${busMessage.id}.(error|finished)`,
      msg => {
        unsubscribe();
        stack.pop();
        if (msg.isError) {
          // Generator exception handling,
          // see https://gist.github.com/deepak/e325fa2d1a39984fd3e9
          setTimeout(() => {
            try {
              finishHandler(msg.data);
            } catch (ex) {
              // ignore
            }
          }, 0);
        } else {
          finishHandler(null, msg);
        }
      }
    );

    xLog.verb('finish handler registered for cmd: ' + cmd);
  }

  xLog.verb("client send '%s' command", cmd);
  self._push.send(cmd, busMessage);
};

module.exports = Command;
