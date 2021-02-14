/**
 * @format
 * @flow
 */

import {createStore} from 'redux';

import ApiClient from './api';
import {TriggerTypes, Version} from './constants';
import {
  reducer,
  setEventTraits,
  setLastUpdated,
  setUserAuthToken,
  setUserTraits,
  showPrompt,
  showSurvey,
} from './redux';
import type {EmbedContext, EventTraits, Survey, UserTraits} from './types';
import Storage, {Keys} from './storage';

export const store = createStore(reducer);

class Iterate {
  api: ApiClient;
  eventQueue: string[] = [];
  initialized: boolean = false;

  // Indicate that the client is fully initialized and ready to send events
  init = () => {
    this.initialized = true;
    this.eventQueue.forEach((event) => {
      this.sendEvent(event);
    });
  };

  configure = (apiKey: string) => {
    this.api = new ApiClient(apiKey);
  };

  identify = (userTraits?: UserTraits, eventTraits?: EventTraits) => {
    if (userTraits != null) {
      store.dispatch(setUserTraits(userTraits));
      Storage.set(Keys.userTraits, userTraits);
    }

    if (eventTraits != null) {
      store.dispatch(setEventTraits(eventTraits));
    }
  };

  sendEvent = (eventName: string) => {
    // If the client hasn't been initialized yet (e.g. loading async data from local storage)
    // then queue up the events. Shouldn't have to wait more than a few milliseconds or less
    if (this.initialized !== true) {
      this.eventQueue.push(eventName);
      return;
    }

    const state = store.getState();

    const embedContext: EmbedContext = {
      app: {version: Version},
      event: {name: eventName},
      type: 'mobile',
    };

    if (Object.keys(state.userTraits).length > 0) {
      embedContext.user_traits = state.userTraits;
    }

    if (state.lastUpdated != null) {
      embedContext.tracking = {
        last_updated: state.lastUpdated,
      };
    }

    return this.api.embed(embedContext).then((response) => {
      // Set the user auth token if one is returned
      if (response.auth != null && response.auth.token != null) {
        const token = response.auth.token;
        store.dispatch(setUserAuthToken(token));
        Storage.set(Keys.authToken, token);
      }

      // Set the last updated time if one is returned
      if (response.tracking != null && response.tracking.last_updated != null) {
        const lastUpdated = response.tracking.last_updated;
        store.dispatch(setLastUpdated(lastUpdated));
        Storage.set(Keys.lastUpdated, lastUpdated);
      }

      if (response != null && response.survey != null) {
        // If the survey has a timer trigger, wait that number of seconds before showing the survey
        if (
          response.triggers != null &&
          response.triggers.length > 0 &&
          response.triggers[0].type === TriggerTypes.Seconds
        ) {
          const survey = response.survey;
          setTimeout(() => {
            this.dispatchShowSurveyOrPrompt(survey);
          }, (response.triggers[0].options.seconds || 0) * 1000);
        } else {
          this.dispatchShowSurveyOrPrompt(response.survey);
        }
      }

      return response;
    });
  };

  dispatchShowSurveyOrPrompt(survey: Survey) {
    if (survey.prompt != null) {
      store.dispatch(showPrompt(survey));
    } else {
      store.dispatch(showSurvey(survey));
    }

    this.api.displayed(survey);
  }
}

export default new Iterate();
