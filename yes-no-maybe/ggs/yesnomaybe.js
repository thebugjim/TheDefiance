/*
 * Copyright (c) 2011 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may obtain
 * a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

/**
 * @fileoverview Logic for the Yes/No/Maybe app.
 *
 * @author Tim Blasi (Google)
 */

/** @enum {string} */
var Answers = {
  YES: 'y',
  NO: 'n',
  MAYBE: 'm'
};
var HOST = '//hangoutsapi.appspot.com/static/yesnomaybe';

var DEFAULT_ICONS = {};
DEFAULT_ICONS[Answers.YES] = HOST + '/yes.png';
DEFAULT_ICONS[Answers.NO] = HOST + '/no.png';
DEFAULT_ICONS[Answers.MAYBE] = HOST + '/maybe.png';

var DEFAULT_STATUS = {};
DEFAULT_STATUS[Answers.YES] = 'Yes';
DEFAULT_STATUS[Answers.NO] = 'No';
DEFAULT_STATUS[Answers.MAYBE] = 'Maybe';

var STATES = {
  LOBBY: 'lobby',
  SPLASH: 'splash',
  NIGHT: 'night',
  DAY: 'day'
};
var currentState = STATES.LOBBY;
var ROLES = {
  CIVILIAN: 'civ',
  SPY: 'spy',
  DEAD: 'ded'
}
var spiesRemaining;

var timeouts = [];

/**
 * The maximum length allowed for user status.
 * @const
 * @type {number}
 */
var MAX_STATUS_LENGTH = 255;

/**
 * Whether the user is currently editing his status.
 * @type {boolean}
 * @private
 */
var statusVisible_ = false;

/**
 * Shared state of the app.
 * @type {Object.<!string, !string>}
 * @private
 */
var state_ = null;

/**
 * Describes the shared state of the object.
 * @type {Object.<!string, Object.<!string, *>>}
 * @private
 */
var metadata_ = null;

/**
 * A list of the participants.
 * @type {Array.<gapi.hangout.Participant>}
 * @private
 */
var participants_ = null;

/**
 * The form that contains the status input element.
 * @type {Element}
 * @private
 */
var statusForm_ = null;

/**
 * The element used to input status messages.
 * @type {Element}
 * @private
 */
var statusInput_ = null;

/**
 * The container for the app controls.
 * @type {Element}
 * @private
 */
var container_ = null;

/**
 * Executes the provided function after a minor delay.
 * @param {function()} func The function to execute.
 */
function defer(func) {
  window.setTimeout(func, 10);
}

/**
 * Creates a key for use in the shared state.
 * @param {!string} id The user's temporary id.
 * @param {!string} key The property to create a key for.
 * @return {!string} A new key for use in the shared state.
 */
function makeUserKey(id, key) {
  return id + ':' + key;
}

/**
 * Makes an RPC call to store the given value(s) in the shared state.
 * @param {!(string|Object.<!string, !string>)} keyOrState Either an object
 *     denoting the desired key value pair(s), or a single string key.
 * @param {!string=} opt_value If keyOrState is a string, the associated value.
 */
var saveValue = null;

/**
 * Makes an RPC call to remove the given value(s) from the shared state.
 * @param {!(string|Array.<!string>)} keyOrListToRemove A single key
 *     or an array of strings to remove from the shared state.
 */
var removeValue = null;

/**
 * Makes an RPC call to add and/or remove the given value(s) from the shared
 * state.
 * @param {?(string|Object.<!string, !string>)} addState  Either an object
 *     denoting the desired key value pair(s), or a single string key.
 * @param {?(string|Object.<!string, !string>)=} opt_removeState A list of keys
 *     to remove from the shared state.
 */
var submitDelta = null;

(function() {
  /**
   * Packages the parameters into a delta object for use with submitDelta.
   * @param {!(string|Object.<!string, !string>)}  Either an object denoting
   *     the desired key value pair(s), or a single string key.
   * @param {!string=} opt_value If keyOrState is a string, the associated
   *     string value.
   */
  var prepareForSave = function(keyOrState, opt_value) {
    var state = null;
    if (typeof keyOrState === 'string') {
      state = {};
      state[keyOrState] = opt_value;
    } else if (typeof keyOrState === 'object' && null !== keyOrState) {
      // Ensure that no prototype-level properties are hitching a ride.
      state = {};
      for (var key in keyOrState) {
        if (keyOrState.hasOwnProperty(key)) {
          state[key] = keyOrState[key];
        }
      }
    } else {
      throw 'Unexpected argument.';
    }
    return state;
  };

  /**
   * Packages one or more keys to remove for use with submitDelta.
   * @param {!(string|Array.<!string>)} keyOrListToRemove A single key
   *     or an array of strings to remove from the shared state.
   * @return {!Array.<!string>} A list of keys to remove from the shared state.
   */
  var prepareForRemove = function(keyOrListToRemove) {
    var delta = null;
    if (typeof keyOrListToRemove === 'string') {
      delta = [keyOrListToRemove];
    } else if (typeof keyOrListToRemove.length === 'number' &&
               keyOrListToRemove.propertyIsEnumerable('length')) {
      // Discard non-string elements.
      for (var i = 0, iLen = keyOrListToRemove.length; i < iLen; ++i) {
        if (typeof keyOrListToRemove[i] === 'string') {
          delta.push(keyOrListToRemove[i]);
        }
      }
    } else {
      throw 'Unexpected argument.';
    }
    return delta;
  };

  /**
   * Makes an RPC call to add and/or remove the given value(s) from the shared
   * state.
   * @param {?(string|Object.<!string, !string>)} addState  Either an object
   *     denoting the desired key value pair(s), or a single string key.
   * @param {?(string|Object.<!string, !string>)=} opt_removeState A list of
   *     keys to remove from the shared state.
   */
  var submitDeltaInternal = function(addState, opt_removeState) {
    gapi.hangout.data.submitDelta(addState, opt_removeState);
  };

  saveValue = function(keyOrState, opt_value) {
    var delta = prepareForSave(keyOrState, opt_value);
    if (delta) {
      submitDeltaInternal(delta);
    }
  };

  removeValue = function(keyOrListToRemove) {
    var delta = prepareForRemove(keyOrListToRemove);
    if (delta) {
      submitDeltaInternal({}, delta);
    }
  };

  submitDelta = function(addState, opt_removeState) {
    if ((typeof addState !== 'object' && typeof addState !== 'undefined') ||
        (typeof opt_removeState !== 'object' &&
         typeof opt_removeState !== 'undefined')) {
      throw 'Unexpected value for submitDelta';
    }
    var toAdd = addState ? prepareForSave(addState) : {};
    var toRemove = opt_removeState ? prepareForRemove(opt_removeState) :
        undefined;
    submitDeltaInternal(toAdd, toRemove);
  };
})();

/**
 * Stores the user's answer in the shared state, or removes it from the shared
 * state if it is the same as the current value.
 * @param {!Answers} newAnswer The user's answer.
 */
function onAnswer(newAnswer) {
  // Gets the temporary hangout id, corresponding to Participant.id
  // rather than Participant.id.
  var myId = getUserHangoutId();

  var answerKey = makeUserKey(myId, 'answer');
  var current = getState(answerKey);

  if (current === newAnswer) {
    removeValue(answerKey);
  } else {
    saveValue(answerKey, newAnswer);
  }
}

/**
 * @param {!string} participantId The temporary id of a Participant.
 * @return {string} The status of the given Participant.
 */
function getStatusMessage(participantId) {
  return getState(makeUserKey(participantId, 'status'));
}

/**
 * Sets the status for the current user.
 * @param {!string} message The user's new status.
 */
function setStatusMessage(message) {
  saveValue(makeUserKey(getUserHangoutId(), 'status'), message);
}

/**
 * Displays the input allowing a user to set his status.
 * @param {!Element} linkElement The link that triggered this handler.
 */
function onSetStatus(linkElement) {
  statusVisible_ = true;
  statusInput_.fadeIn(500);
  $(linkElement).parent('p').hide();
  $(linkElement).parent('p').parent().append(statusInput_);
  statusInput_.val(getStatusMessage(getUserHangoutId()));
  // Since faceIn is a black box, focus & select only if the input is already
  // visible.
  statusInput_.filter(':visible').focus().select();
}

/**
 * Sets the user's status message and hides the input element.
 */
function onSubmitStatus() {
  if (statusVisible_) {
    statusVisible_ = false;
    var statusVal = statusInput_.val();
    statusVal = statusVal.length < MAX_STATUS_LENGTH ? statusVal :
        statusVal.substr(0, MAX_STATUS_LENGTH);
    setStatusMessage(statusVal);
    statusForm_.append(statusInput_);
    statusInput_.hide();
    render();
  }
}

/**
 * Gets the value of opt_stateKey in the shared state, or the entire state
 * object if opt_stateKey is null or not supplied.
 * @param {?string=} opt_stateKey The key to get from the state object.
 * @return {(string|Object.<string,string>)} A state value or the state object.
 */
function getState(opt_stateKey) {
  return (typeof opt_stateKey === 'string') ? state_[opt_stateKey] : state_;
}

/**
 * Gets the value of opt_metadataKey in the shared state, or the entire
 * metadata object if opt_metadataKey is null or not supplied.
 * @param {?string=} opt_metadataKey The key to get from the metadata object.
 * @return {(Object.<string,*>|Object<string,Object.<string,*>>)} A metadata
 *     value or the metadata object.
 */
function getMetadata(opt_metadataKey) {
  return (typeof opt_metadataKey === 'string') ? metadata_[opt_metadataKey] :
      metadata_;
}

/**
 * @return {string} The user's ephemeral id.
 */
function getUserHangoutId() {
  return gapi.hangout.getParticipantId();
}

/**
 * Renders the app.
 */
function render() {
  if (!state_ || !metadata_ || !participants_ || !container_) {
    return;
  }

  if (statusVisible_) {
    // Wait until we're done editing status, otherwise everything will render,
    // messing up our edit.
    return;
  }

  var cloudState = getState('state');
  if (cloudState === undefined) {
    saveValue('state', STATES.LOBBY);
    currentState = STATES.LOBBY;
  } else {
    if (currentState != getState) {
      for (var time in timeouts) {
        clearTimeout(timeouts[time]);
      }
      timeouts = [];
    }
    currentState = getState('state');
  }

  var data = {
    total: 0,
    responded: false
  };
  data[Answers.YES] = [];
  data[Answers.NO] = [];
  data[Answers.MAYBE] = [];

  var myId = getUserHangoutId();
  for (var i = 0, iLen = participants_.length; i < iLen; ++i) {
    var p = participants_[i];
    // Temporary id, corresponds to getUserHangoutId().
    var answerKey = makeUserKey(p.id, 'answer');
    var answer = getState(answerKey);
    var meta = getMetadata(answerKey);

    // test

    if (answer && data[answer]) {
      data[answer].push(p);
      if (p.id === myId) {
        data.responded = true;
      }
      ++data.total;

      var name = p.person.displayName;
      var parts = name.split('@');
      if (parts && parts.length > 1) {
        p.person.displayName = parts[0];
      }

      p.status = getStatusMessage(p.id) || '';
      // The server stores a timestamp for us on each change. We'll use this
      // value to display users in the order in which they answer.
      p.sortOrder = meta.timestamp;
    }
  }

  //test
  if (currentState == STATES.LOBBY) {
    container_
        .empty()
        .append(createTestTable(data));
  } else if (currentState == STATES.SPLASH) {
    container_
        .empty()
        .append(createSplash(data));
  } else if (currentState == STATES.NIGHT) {
    container_
        .empty()
        .append(createNight(data));
  } else if (currentState == STATES.DAY) {
    container_
        .empty()
        .append(createDay(data));
                

  }

  // Sort by vote order.
  var sortFunc = function(a, b) {
    return a.sortOrder - b.sortOrder;
  };
  for (var answer in data) {
    if (data.hasOwnProperty(answer) && data[answer].sort) {
      data[answer].sort(sortFunc);
    }
  }

  // container_
  //     .empty()
  //     .append(createAnswersTable(data));


}

/**
 * Syncs local copies of shared state with those on the server and renders the
 *     app to reflect the changes.
 * @param {!Object.<!string, !string>} state The shared state.
 * @param {!Object.<!string, Object.<!string, *>>} metadata Data describing the
 *     shared state.
 */
function updateLocalDataState(state, metadata) {
  state_ = state;
  metadata_ = metadata;
  render();
}

/**
 * Syncs local copy of the participants list with that on the server and renders
 *     the app to reflect the changes.
 * @param {!Array.<gapi.hangout.Participant>} participants The new list of
 *     participants.
 */
function updateLocalParticipantsData(participants) {
  participants_ = participants;
  render();
}

/***
 * Create required DOM elements and listeners.
 */
function prepareAppDOM() {
  statusInput_ = $('<input />')
      .attr({
        'id': 'status-input',
        'type': 'text',
        'maxlength': MAX_STATUS_LENGTH
      });
  statusForm_ = $('<form />')
      .attr({
        'action': '',
        'id': 'status-form'
      })
      .append(statusInput_);

  var statusDiv = $('<div />')
      .attr('id', 'status-box')
      .addClass('status-box')
      .append(statusForm_);

  statusForm_.submit(function() {
    onSubmitStatus();
    return false;
  });

  statusInput_.keypress(function(e) {
    if (e.which === 13) {
      defer(onSubmitStatus);
    }
    e.stopPropagation();
  }).blur(function(e) {
    onSubmitStatus();
    e.stopPropagation();
  }).mousedown(function(e) {
    e.stopPropagation();
  }).hide();

  container_ = $('<div />');

  var body = $('body');
  body.mousedown(function(e) {
    if (statusVisible_) {
      onSubmitStatus();
    }
    e.stopPropagation();
  }).append(container_, statusDiv);
}

/**
 * Creates the DOM element that shows the button for each response and displays
 * each participant under his answer.
 * @param {!Object.<!string, *>} data The information used to populate the
 *     table.
 * @return {Element} The DOM element displaying the app's main interface.
 */
function createAnswersTable(data) {
  var buttonRow = $('<tr />');

  var onButtonMouseDown = function() {
    $(this).addClass('selected');
  };
  var getButtonMouseUpHandler = function(ans) {
    return function() {
      $(this).removeClass('selected');
      onAnswer(ans);
    };
  };

  // Create buttons for each possible response.
  for (var key in Answers) {
    if (Answers.hasOwnProperty(key)) {
      var ans = Answers[key];

      var numAnswered = $('<span />')
          .text(' (' + data[ans].length + ')');
      var ansLink = $('<a />')
          .attr('href', '#')
          .text(DEFAULT_STATUS[ans])
          .append(numAnswered)
          .click(function() {
            return false;
          });
      var ansBtn = $('<div />')
          .addClass('button')
          .append(ansLink)
          .mousedown(onButtonMouseDown)
          .mouseup(getButtonMouseUpHandler(ans));

      var respondList = $('<ul />');
      for (var i = 0, iLen = data[ans].length; i < iLen; ++i) {
        respondList.append(createParticipantElement(data[ans][i], ans));
      }

      var ansCell = $('<td />')
          .attr('id', key)
          .append(ansBtn, respondList);

      // Add list of participants below each button.
      buttonRow.append(ansCell);
    }
  }

  var table = $('<table />')
      .attr({
        'cellspacing': '2',
        'cellpadding': '0',
        'summary': '',
        'width': '100%'
      }).append(buttonRow);

  if (!data.responded) {
    var instructImg = $('<img />')
        .attr({
          'src': '//hangoutsapi.appspot.com/static/yesnomaybe/directions.png',
          'title': 'Make a selection'
        });
    var instructText = $('<div />')
        .text('Click an option to cast your vote');
    var footDiv = $('<div />').append(instructImg, instructText);
    var footCell = $('<td colspan="3" />')
        .append(footDiv);
    var footRow = $('<tr />')
        .attr('id', 'footer')
        .addClass('footer')
        .append(footCell);

    table.append(footRow);
  }

  return table;
}

function createTestTable(data) {
  var titleRow = createTitleRow("Welcome to Spies");
  var buttonRow = $('<tr />');

  var onButtonMouseDown = function() {
    $(this).addClass('selected');
  };
  var getButtonMouseUpHandler = function(ans) {
    return function() {
      $(this).removeClass('selected');
      onAnswer(ans);
    };
  };

  var respondList = $('<ul />');
  for (var i = 0, iLen = participants_.length; i < iLen; ++i) {
    var player = participants_[i];
    respondList.append(createParticipantElement(player, 'hi?'));
  }
  var ansCell = $('<td />')
      .append(respondList);

  var ansLink = $('<a />')
      .attr('href', '#')
      .text('Start Game')
      .click(startGame);
  var ansBtn = $('<div />')
      .addClass('button')
      .append(ansLink);
      //.mousedown(onButtonMouseDown)
      //.mouseup(getButtonMouseUpHandler(ans));

  buttonRow.append(ansCell, ansBtn);

  // // Create buttons for each possible response.
  // for (var key in Answers) {
  //   if (Answers.hasOwnProperty(key)) {
  //     var ans = Answers[key];

  //     var respondList = $('<ul />');
  //     for (var i = 0, iLen = data[ans].length; i < iLen; ++i) {
  //       respondList.append(createParticipantElement(data[ans][i], ans));
  //     }

  //     var ansCell = $('<td />')
  //         .attr('id', key)
  //         .append(ansBtn, respondList);

  //     // Add list of participants below each button.
  //     buttonRow.append(ansCell);
  //   }
  // }

  var table = $('<table />')
      .attr({
        'cellspacing': '2',
        'cellpadding': '0',
        'summary': '',
        'width': '100%'
      }).append(titleRow, buttonRow);

  // if (!data.responded) {
  //   var instructImg = $('<img />')
  //       .attr({
  //         'src': '//hangoutsapi.appspot.com/static/yesnomaybe/directions.png',
  //         'title': 'Make a selection'
  //       });
  //   var instructText = $('<div />')
  //       .text('Click an option to cast your vote');
  //   var footDiv = $('<div />').append(instructImg, instructText);
  //   var footCell = $('<td colspan="3" />')
  //       .append(footDiv);
  //   var footRow = $('<tr />')
  //       .attr('id', 'footer')
  //       .addClass('footer')
  //       .append(footCell);

  //   table.append(footRow);
  // }

  return table;
}

function createSplash(data) {
  var titleRow = createTitleRow("This is your role");
  var buttonRow = $('<tr />');

  var myId = getUserHangoutId();

  var respondList = $('<ul />');
  for (var i = 0, iLen = participants_.length; i < iLen; ++i) {
    var player = participants_[i];
    if (player.id == myId && getState(makeUserKey(myId, 'role')) 
      == ROLES.CIVILIAN)
      respondList.append(
        createParticipantElement(
          player, getState(
            makeUserKey(myId, 'role'))));
    if (getState(makeUserKey(myId, 'role')) == ROLES.SPY && 
      getState(makeUserKey(player.id, 'role')) == ROLES.SPY)
    {
      respondList.append(
        createParticipantElement(
          player, ROLES.SPY))
    }
  }
  var ansCell = $('<td />')
      .append(respondList);

  // var ansLink = $('<a />')
  //     .attr('href', '#')
  //     .text('Start Game')
  //     .click(startGame);
  // var ansBtn = $('<div />')
  //     .addClass('button')
  //     .append(ansLink);
      //.mousedown(onButtonMouseDown)
      //.mouseup(getButtonMouseUpHandler(ans));

  buttonRow.append(ansCell);

  var table = $('<table />')
      .attr({
        'cellspacing': '2',
        'cellpadding': '0',
        'summary': '',
        'width': '100%'
      }).append(titleRow, buttonRow);

  window.setTimeout(function() {
    saveValue('state', STATES.NIGHT);
  }, 8000);

  return table;
}

function createNight(data) {
  console.log('NIGHT FUNCTION STARTED');
  var buttonRow = $('<tr />');

  var myId = getUserHangoutId();
  var myRole = getState(makeUserKey(myId, 'role'));


  var title = '';
  var nextlynched = getState("nextlynched");
  if (nextlynched === undefined) {
    title = myRole == ROLES.SPY ? "It's nighttime. Pick a civilian to kill." :
    "It's nighttime. Standby."
  } else {
    for (var i = 0, iLen = participants_.length; i < iLen; ++i) {
      var player = participants_[i];
      if (player.id == nextlynched) {
        title = player.person.displayName.concat(" was lynched. It's nighttime.");
      }
    }
  }
  var titleRow = createTitleRow(title);

  var respondList = $('<ul />');
  var killVotes = [];
  for (var i = 0, iLen = participants_.length; i < iLen; ++i) {
    var player = participants_[i];
    var playerRole = getState(makeUserKey(player.id, 'role'));
    if (myRole == ROLES.CIVILIAN) {
      if (playerRole == ROLES.CIVILIAN) {
        if (myId == player.id) {
          var nextCiv = $('<li />')
            .text('civilian: you');
          respondList.append(nextCiv);     
        } else {
          var nextCiv = $('<li />')
            .text('civilian: ?????');
          respondList.append(nextCiv);     
        }
      } else if (playerRole == ROLES.SPY) {
        var nextCiv = $('<li />')
          .text('spy: ?????');
        respondList.append(nextCiv);
      }
    } else if (myRole == ROLES.SPY) {
      if (playerRole == ROLES.CIVILIAN) {
        var numVotes = 0;
        for (var j = 0, jLen = participants_.length; j < jLen; ++j)
        {
          var innerid = participants_[j].id;
      // console.log('SHOULD BE CIVILIAN');
      // console.log(player.id);
      // console.log('MY ID IS');
      // console.log(myId);
      // console.log('ROLE OF INNER IS');
      // console.log(getState(makeUserKey(innerid, 'role')));
      // console.log(ROLES.SPY);
      // console.log('IF SPY SPY, THE KILLVOTE IS');
      // console.log(getState(makeUserKey(innerid, 'killvote')));
      // console.log('SHOULD BE SAME AS');
      // console.log(player.id);
      console.log('THE PLAYER IN FOCUS IS');
      console.log(player.id);
      console.log('LOOKING AT VOTE OF');
      console.log(innerid);
      console.log('ROLE OF INNER IS');
      console.log(getState(makeUserKey(innerid, 'role')));
      console.log('THE KILL VOTE IS');
      console.log(getState(makeUserKey(innerid, 'killvote')));
      
          if(getState(makeUserKey(innerid, 'role')) === ROLES.SPY &&
            getState(makeUserKey(innerid, 'killvote')) === player.id)
          {
            numVotes++;
            console.log('NUMVOTES INCREASED');
          }

          // respondList.append(
          //   createParticipantElement(player, numVotes).on("click",function(){
          //     saveValue(makeUserKey(myId, 'killvote'), player.id);
          //   }));
        }
        respondList.append(
          createParticipantElement(player, numVotes)
            .click(function(){
              console.log('KILLVOTE CLICKED');
              console.log('I AM');
              console.log(myId);
              console.log('VOTING FOR');
              console.log(player.id);
              saveValue(makeUserKey(myId, 'killvote'), player.id);
            })());
        killVotes[player.id] = numVotes;
      }
    }
  }

  console.log('NIGHT FOR LOOPS END');

  var ansCell = $('<td />')
      .append(respondList);

  // var ansLink = $('<a />')
  //     .attr('href', '#')
  //     .text('Start Game')
  //     .click(startGame);
  // var ansBtn = $('<div />')
  //     .addClass('button')
  //     .append(ansLink);
      //.mousedown(onButtonMouseDown)
      //.mouseup(getButtonMouseUpHandler(ans));

  buttonRow.append(ansCell);

  var table = $('<table />')
      .attr({
        'cellspacing': '2',
        'cellpadding': '0',
        'summary': '',
        'width': '100%'
      }).append(titleRow, buttonRow);


  var timer = window.setTimeout(function() {
    var max = -1;
    if (myRole != ROLES.SPY) return;
    for (var count in killVotes) {
      if (killVotes[count] > max) max = killVotes[count];
    }
    for (var count in killVotes) {
      if (killVotes[count] == max) {
        saveValue('nextdead', count);
        saveValue(makeUserKey(count, 'role'), ROLES.DEAD);
        break;
      }
    }
    console.log('night timer returned from');
    saveValue('state', STATES.DAY);
  }, 15000);
  timeouts[timer] = timer;

  return table;
}

function createDay(data) {
  console.log('DAY STARTED');
  var deadString;
  for (var i = 0, iLen = participants_.length; i < iLen; ++i) {
    var player = participants_[i];
    if (player.id == getState('nextdead')) {
      deadString = player.person.displayName.concat(" died last night. Vote to lynch.");
    }
  }
  var deadRow = createTitleRow(deadString);
  var buttonRow = $('<tr />');

  var myId = getUserHangoutId();
  var myRole = getState(makeUserKey(myId, 'role'));

  var respondList = $('<ul />');
  var lynchVotes = [];
  console.log('DAY FOR LOOPS STARTED');
  for (var i = 0, iLen = participants_.length; i < iLen; ++i) {
    var player = participants_[i];
    var playerRole = getState(makeUserKey(player.id, 'role'));
    if (playerRole == ROLES.DEAD || player.id == getState('nextdead')) continue;
    var numVotes = 0;
    for (var j = 0, jLen = participants_.length; j < jLen; ++j)
    {
      var innerid = participants_[j].id;
      /*console.log(getState(makeUserKey(innerid, 'lynchvote')))
      console.log(player.id);
      console.log(getState(makeUserKey(innerid, 'role')))
      console.log(ROLES.DEAD);*/
      console.log('THE PLAYER IN FOCUS IS');
      console.log(player.id);
      console.log('LOOKING AT VOTE OF');
      console.log(innerid);
      console.log('ROLE OF INNER IS');
      console.log(getState(makeUserKey(innerid, 'role')));
      console.log('THE LYNCH VOTE IS');
      console.log(getState(makeUserKey(innerid, 'lynchvote')));
      
      if(getState(makeUserKey(innerid, 'lynchvote')) === player.id
        && getState(makeUserKey(innerid, 'role')) !== ROLES.DEAD)
      {
        numVotes++;
        console.log('LYNCHNUMVOTES INCREASED');
      }

      // respondList.append(
      //   createParticipantElement(player, numVotes).on("click",function(){
      //     saveValue(makeUserKey(myId, 'lynchvote'), player.id);
      //   }));
    }
    respondList.append(
      createParticipantElement(player, numVotes)
        .click(function(){
          console.log('LYNCHVOTE CLICKED');
          console.log('SAVING LYNCHVOTE OF');
          console.log(myId);
          console.log('AS');
          console.log(player.id);
          saveValue(makeUserKey(myId, 'lynchvote'), player.id);
        })());
    lynchVotes[player.id] = numVotes;
  }
  var ansCell = $('<td />')
      .append(respondList);

  // var ansLink = $('<a />')
  //     .attr('href', '#')
  //     .text('Start Game')
  //     .click(startGame);
  // var ansBtn = $('<div />')
  //     .addClass('button')
  //     .append(ansLink);
      //.mousedown(onButtonMouseDown)
      //.mouseup(getButtonMouseUpHandler(ans));

  buttonRow.append(ansCell);

  var table = $('<table />')
      .attr({
        'cellspacing': '2',
        'cellpadding': '0',
        'summary': '',
        'width': '100%'
      }).append(deadRow, buttonRow);

  var timer = window.setTimeout(function() {
    if (myRole != ROLES.SPY) return;
    var max = -1;
    for (var count in lynchVotes) {
      if (lynchVotes[count] > max) max = lynchVotes[count];
    }
    for (var count in lynchVotes) {
      if (lynchVotes[count] == max) {
        saveValue('nextlynched', count);
        saveValue(makeUserKey(count, 'role'), ROLES.DEAD);
        break;
      }
    }
    saveValue('state', STATES.NIGHT);
  }, 15000);
  timeouts[timer] = timer;

  return table;
}

//test
function startGame() {
  var numSpies = spiesRemaining = Math.floor(participants_.length / 2);
  var numCivs = participants_.length - numSpies;
  var shuffled_ = shuffle(participants_);
  for (var i = 0, iLen = shuffled_.length; i < iLen; ++i) {
    var p = shuffled_[i];
    var role;
    if (numSpies > 0) {
      role = ROLES.SPY;
      numSpies--;
    } else {
      role = ROLES.CIVILIAN;
      numCivs--;
    }
    saveValue(makeUserKey(p.id, 'role'), role);

    // if (answer && data[answer]) {
    //   data[answer].push(p);
    //   if (p.id === myId) {
    //     data.responded = true;
    //   }
    //   ++data.total;

    //   var name = p.person.displayName;
    //   var parts = name.split('@');
    //   if (parts && parts.length > 1) {
    //     p.person.displayName = parts[0];
    //   }

    //   p.status = getStatusMessage(p.id) || '';
    //   // The server stores a timestamp for us on each change. We'll use this
    //   // value to display users in the order in which they answer.
    //   p.sortOrder = meta.timestamp;
    // }
  }
  currentState = STATES.SPLASH;
  saveValue('state', currentState);
  render();
}

/**
 * Creates the DOM element that shows a single participant's answer.
 * @param {!gapi.hangout.Participant} participant The participant to create the
 *     display element for.
 * @param {!Answers} response The participant's answer.
 * @return {Element} A DOM element which shows a participant and allows him to
 *     modify his status.
 */
function createParticipantElement(participant, response) {
  var avatar = $('<img />').attr({
    'width': '27',
    'alt': 'Avatar',
    'class': 'avatar',
    'src': participant.person.image && participant.person.image.url ?
        participant.person.image.url : DEFAULT_ICONS[response]
  });

  var name = $('<h2 />').text(participant.person.displayName);

  var statusText = response;
//  var statusText = getStatusMessage(participant.id) || '';
  var statusAnchor = $('<p />')
      .addClass('status-anchor')
      .text(statusText + ' ');
  if (participant.id === getUserHangoutId()) {
    var triggerLink = $('<a href="#" class="link" />')
        .text(/*statusText ? 'Edit' : 'Set your status'*/'')
        .click(function() {
          onSetStatus(this);
          return false;
        });

    statusAnchor.append(triggerLink);
  }

  return $('<li />').append(avatar, name, statusAnchor);
}

function createTitleRow(title) {
  
  
  var para = $('<p />')
    .text(title);
  var cell = $('<td />').append(para);
  return $('<tr />').append(cell);
}

(function() {
  if (gapi && gapi.hangout) {

    var initHangout = function(apiInitEvent) {
      if (apiInitEvent.isApiReady) {
        prepareAppDOM();

        gapi.hangout.data.onStateChanged.add(function(stateChangeEvent) {
          updateLocalDataState(stateChangeEvent.state,
                               stateChangeEvent.metadata);
        });
        gapi.hangout.onParticipantsChanged.add(function(partChangeEvent) {
          updateLocalParticipantsData(partChangeEvent.participants);
        });

        if (!state_) {
          var state = gapi.hangout.data.getState();
          var metadata = gapi.hangout.data.getStateMetadata();
          if (state && metadata) {
            updateLocalDataState(state, metadata);
          }
        }
        if (!participants_) {
          var initParticipants = gapi.hangout.getParticipants();
          if (initParticipants) {
            updateLocalParticipantsData(initParticipants);
          }
        }


        gapi.hangout.onApiReady.remove(initHangout);
      }
    };

    gapi.hangout.onApiReady.add(initHangout);
  }
})();


function shuffle(array) {
  var currentIndex = array.length, temporaryValue, randomIndex ;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}