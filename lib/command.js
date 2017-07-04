'use strict';

var moduleName = 'busclient/command';

var xLog = require ('xcraft-core-log') (moduleName, null);

function Command (busClient, pushSocket) {
  this._busClient = busClient;
  this._push = pushSocket;
}

Command.prototype.newMessage = function (cmd, which) {
  if (!which) {
    which = this._busClient.getOrcName () || 'greathall';
  }

  return this._busClient.newMessage (cmd, which);
};

/**
 * Send a command on the bus.
 *
 * If a callback is specified, the finished topic is automatically
 * subscribed to the events bus. Then when the callback is called, the
 * topic is unsubscribed.
 *
 * @param {string} cmd - Command's name.
 * @param {Object} data - Map of arguments passed to the command.
 * @param {string} which - Orc name or greathall.
 * @param {function(err, results)} [finishHandler] - Callback.
 */
Command.prototype.send = function (cmd, data, which, finishHandler) {
  var self = this;

  if (!which) {
    which = this._busClient.getOrcName () || 'greathall';
  }

  let busMessage = data;
  if (!data || !data._xcraftMessage) {
    busMessage = self.newMessage (cmd, which);
    busMessage.data = data;
  }

  if (finishHandler) {
    let finishUnsubscribe = null;
    /* Subscribe to error in command notification. */
    const errorTopic = `${which}::${cmd}.${busMessage.id}.error`;
    const errUnsubscribe = self._busClient.events.subscribe (
      errorTopic,
      function (msg) {
        errUnsubscribe ();
        finishUnsubscribe ();
        finishHandler (msg.data);
      }
    );

    /* Subscribe to end command notification. */
    const finishTopic = `${which}::${cmd}.${busMessage.id}.finished`;
    finishUnsubscribe = self._busClient.events.subscribe (
      finishTopic,
      function (msg) {
        errUnsubscribe ();
        finishUnsubscribe ();
        finishHandler (null, msg);
      }
    );

    xLog.verb ('finish handler registered for cmd: ' + cmd);
  }

  xLog.verb ("client send '%s' command", cmd);
  self._push.send (cmd, busMessage);
};

module.exports = Command;
