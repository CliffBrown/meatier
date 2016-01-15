import jwtDecode from 'jwt-decode';
import fetch from 'isomorphic-fetch';
import {pushPath, replacePath} from 'redux-simple-router';
import {postJSON, parseJSON, getJSON, hostUrl, fetchGraphQL, getGraphQLError} from '../../../utils/fetching';
import socketOptions from '../../../utils/socketOptions';
import validateSecretToken from '../../../utils/validateSecretToken';
import Immutable from 'immutable';
import {ensureState} from 'redux-optimistic-ui';


const {authTokenName} = socketOptions;

export const LOGIN_USER_REQUEST = 'LOGIN_USER_REQUEST';
export const LOGIN_USER_ERROR = 'LOGIN_USER_ERROR';
export const LOGIN_USER_SUCCESS = 'LOGIN_USER_SUCCESS';
export const SIGNUP_USER_REQUEST = 'SIGNUP_USER_REQUEST';
export const SIGNUP_USER_ERROR = 'SIGNUP_USER_ERROR';
export const SIGNUP_USER_SUCCESS = 'SIGNUP_USER_SUCCESS';
export const LOGOUT_USER = 'LOGOUT_USER';
export const VERIFY_EMAIL_ERROR = 'VERIFY_EMAIL_ERROR';
export const VERIFY_EMAIL_SUCCESS = 'VERIFY_EMAIL_SUCCESS';

const initialState = Immutable.fromJS({
  error: {},
  isAuthenticated: false,
  isAuthenticating: false,
  authToken: null,
  user: {
    id: null,
    email: null,
    strategies: {}
  }
});

export default function reducer(state = initialState, action = {}) {
  switch (action.type) {
    case LOGIN_USER_REQUEST:
    case SIGNUP_USER_REQUEST:
      return state.merge({
        error: {},
        isAuthenticating: true
      });
    case LOGIN_USER_SUCCESS:
    case SIGNUP_USER_SUCCESS:
      const {authToken, user} = action.payload;
      return state.merge({
        error: {},
        isAuthenticating: false,
        isAuthenticated: true,
        authToken,
        user
      });
    case LOGIN_USER_ERROR:
    case SIGNUP_USER_ERROR:
      return state.merge({
        error: action.error,
        isAuthenticating: false,
        isAuthenticated: false,
        authToken: null,
        user: {}
      });
    case LOGOUT_USER:
      return initialState;
    case VERIFY_EMAIL_ERROR:
      return state.merge({
        error: action.error
      });
    case VERIFY_EMAIL_SUCCESS:
      return state.merge({
        user: {
          strategies: {
            local: {
              isVerified: true
            }
          }
        }
      });
    default:
      return state;
  }
}

export function loginUserSuccess(payload) {
  return {
    type: LOGIN_USER_SUCCESS,
    payload
  }
}

export function loginUserError(error) {
  return {
    type: LOGIN_USER_ERROR,
    error
  }
}

export function signupUserSuccess(payload) {
  return {
    type: SIGNUP_USER_SUCCESS,
    payload
  }
}

export function signupUserError(error) {
  return {
    type: SIGNUP_USER_ERROR,
    error
  }
}

const user = `
{
  id,
  email,
  strategies {
    local {
      isVerified
    }
  }
}`

const userWithAuthToken = `
{
  user ${user},
  authToken
}`

export const loginUser = (dispatch, variables, redirect) => {
  dispatch({type: LOGIN_USER_REQUEST});
  return new Promise(async (resolve, reject) => {
    const query = `
    query($email: email!, $password: password!){
       payload: login(email: $email, password: $password)
       ${userWithAuthToken}
    }`
    const {error, data} = await fetchGraphQL({query, variables});
    if (error) {
      dispatch(loginUserError(error));
      reject(error)
    } else {
      const {payload} = data;
      localStorage.setItem(authTokenName, payload.authToken);
      dispatch(loginUserSuccess(payload));
      dispatch(replacePath(redirect));
      resolve()
    }
  });
}

export function loginToken() {
  return async dispatch => {
    dispatch({type: LOGIN_USER_REQUEST});
    const query = `
    query {
       payload: loginAuthToken
       ${user}
    }`
    const {error, data} = await fetchGraphQL({query});
    if (error) {
      dispatch(loginUserError(error));
    } else {
      const {payload} = data;
      dispatch(loginUserSuccess({user: payload}));
    }
  }
}

export function signupUser(dispatch, variables, redirect) {
  dispatch({type: SIGNUP_USER_REQUEST});
  return new Promise(async function (resolve, reject) {
    const query = `
    mutation($email: email!, $password: password!){
       payload: createUser(email: $email, password: $password)
       ${userWithAuthToken}
    }`
    const {error, data} = await fetchGraphQL({query, variables});
    if (error) {
      dispatch(signupUserError(error));
      reject(error)
    } else {
      const {payload} = data;
      localStorage.setItem(authTokenName, payload.authToken);
      dispatch(signupUserSuccess(payload));
      dispatch(replacePath(redirect));
      resolve()
    }
  });
}
export function emailPasswordReset(variables, dispatch) {
  return new Promise(async function (resolve, reject) {
    const query = `
    mutation($email: email!){
       payload: emailPasswordReset(email: $email)
    }`
    const {error, data} = await fetchGraphQL({query, variables});
    if (error) {
      reject(error)
    } else {
      dispatch(pushPath('/login/reset-email-sent'));
      resolve();
    }
  });
}

export function resetPassword({resetToken, password}, dispatch) {
  return new Promise(async function (resolve, reject) {
    const resetTokenObj = validateSecretToken(resetToken);
    if (resetTokenObj._error) {
      return reject(resetTokenObj._error);
    }
    const query = `
    mutation($password: password!){
       payload: resetPassword(password: $password)
       ${userWithAuthToken}
    }`
    const {error, data} = await fetchGraphQL({query, variables: {password}, resetToken});
    if (error) {
      reject(error);
    } else {
      const {payload} = data;
      localStorage.setItem(authTokenName, payload.authToken);
      dispatch(signupUserSuccess(payload));
      dispatch(replacePath('/login/reset-password-success'));
      resolve();
    }
  });
}



export function verifyEmail(verifiedEmailToken) {
  return async function (dispatch) {
    let res = await postJSON('/auth/verify-email', {verifiedEmailToken});
    if (res.status === 200) {
      return dispatch({type: VERIFY_EMAIL_SUCCESS});
    }
    let parsedRes = await parseJSON(res);
    return dispatch({
      type: VERIFY_EMAIL_ERROR,
      error: parsedRes.error
    });
  }
}

export function oauthLogin(providerEndpoint, redirect) {
  return async function (dispatch) {
    dispatch({type: LOGIN_USER_REQUEST});
    let res = await fetch(hostUrl() + providerEndpoint, {
      //fetch is currently a shitshow, this is just guess & check
      method: 'get',
      mode: 'no-cors',
      credentials: 'include',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    })
    let parsedRes = await parseJSON(res);
    const {error, ...payload} = parsedRes;
    if (payload.authToken) {
      localStorage.setItem(authTokenName, payload.authToken);
      dispatch({type: LOGIN_USER_SUCCESS, payload});
      dispatch(replacePath(redirect));
    } else {
      dispatch({type: LOGIN_USER_ERROR, error});
    }
  }
}


export function logoutAndRedirect() {
  localStorage.removeItem(authTokenName);
  return function (dispatch) {
    dispatch({type: LOGOUT_USER});
    dispatch(replacePath('/'));
  }
}
