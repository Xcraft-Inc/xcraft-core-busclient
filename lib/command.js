'use strict';

var moduleName = 'busclient/command';

var xLog = require ('xcraft-core-log') (moduleName, true);


function Command (busClient, pushSocket) {
  this._busClient = busClient;
  this._push      = pushSocket;
}

/**
 * Send a command on the bus.
 *
 * If a callback is specified, the finished topic is automatically
 * subscribed to the events bus. Then when the callback is called, the
 * topic is unsubscribed.
 *
 * @param {string} cmd - Command's name.
 * @param {Object} [data] - Map of arguments passed to the command.
 * @param {function(err, results)} [finishHandler] - Callback.
 */
Command.prototype.send = function (cmd, data, finishHandler) {
  var self = this;

  if (finishHandler) {
    /* Subscribe to end command notification. */
    var finishTopic = self._busClient.topicModifier (cmd + '.finished');
    self._busClient.events.subscribe (finishTopic);

    self._busClient.getEventsRegistry ()[finishTopic] = function (msg) {
      self._busClient.events.unsubscribe (finishTopic);
      finishHandler (null, msg);
    };

    xLog.verb ('finish handler registered for cmd: ' + cmd);
  }

  var busMessage = self._busClient.newMessage ();

  busMessage.data = data;

  xLog.verb ('client send \'%s\' command', cmd);
  self._push.send (cmd, busMessage);
};

module.exports = Command;
