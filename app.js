'use strict'

const http = require('http')
const https = require('https')
const url = require('url')

const oauth = require('./oauth')
const relative = require('./relative')

const user = '',
    lastfmApiKey = '',
    deezerAppId = '',
    deezerSecret = '',
    minPlayCountAlbum = 16

const lastfmUri = 'http://ws.audioscrobbler.com/2.0/?method=user.&&&METHOD&&&&user=&&&USER&&&&api_key=&&&API_KEY&&&&page=&&&NO_PAGE&&&&format=json'
const lastfmTopAlbums = lastfmUri
    .replace('&&&METHOD&&&', 'gettopalbums')
    .replace('&&&USER&&&', user)
    .replace('&&&API_KEY&&&', lastfmApiKey)
const lastfmTopArtists = lastfmUri
    .replace('&&&METHOD&&&', 'gettopartits')
    .replace('&&&USER&&&', user)
    .replace('&&&API_KEY&&&', lastfmApiKey)

const baseDeezerTokenUri = 'https://connect.deezer.com/oauth/access_token.php?app_id=&&&APP_ID&&&&secret=&&&SECRET&&&&code=&&&CODE&&&&output=json'
const deezerTokenUri = baseDeezerTokenUri
    .replace('&&&APP_ID&&&', deezerAppId)
    .replace('&&&SECRET&&&', deezerSecret)

const deezerFavAlbumUri = 'http://api.deezer.com/user/me/albums/?request_method=POST&album_id=&&&ALBUM_ID&&&&access_token='
const deezerFavArtistUri = 'http://api.deezer.com/user/me/artists/?request_method=POST&artist_id=&&&ARTIST_ID&&&&access_token='
const deezerSearchUri = 'http://api.deezer.com/search/&&&TYPE&&&?q=&&&KEYWORD&&&&strict=on',
    deezerArtistSearch = deezerSearchUri.replace('&&&TYPE&&&', 'artist'),
    deezerAlbumSearch = deezerSearchUri.replace('&&&TYPE&&&', 'album')


function specificHttpsProxyReq(connectDeezerUri, cb) {
  const { hostname, path } = url.parse(connectDeezerUri)
  http.request({ // establishing a tunnel
    host: 'proxy ip here',
    port: 'proxy port here',
    method: 'CONNECT',
    path: 'deezer.com:443',
  }).on('connect', function(res, socket, _) {
    const req = https.get({
      hostname,
      path,
      socket: socket,
      agent: false
    }, (res) => {
      let data = ''
      res.setEncoding('utf8');
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => cb(null, data))
      res.on('error', (err) => cb(err))
    });
    req.on('error', (err) => cb(err))
  }).end();
}

function optProxy(baseOpt) {
  return {
    host: 'proxy ip here',
    port: 'proxy port here',
    path: baseOpt.completeUrl,
    method: baseOpt.method,
  }
}

function req(uri, method, cb) {
  let errorCbCalled = false
  function errorCb(err) {
    if (!errorCbCalled) {
      errorCbCalled = true
      cb(err)
    }
  }
  let { protocol, hostname, path } = url.parse(uri)
  path = encodeURIComponent(path)
  let opt = {
    protocol,
    hostname,
    path,
    method: method,
    completeUrl: encodeURI(uri)
  }
  const isBehindProxy = true
  if (isBehindProxy) {
    opt = optProxy(opt)
  }
  let req = http.request(opt, res => {
    if (res.statusCode !== 200) {
      console.log(`${uri}: ${res.statusCode}`);
    }
    res.setEncoding('utf8')
    let data = ''
    res.on('data', chunk => {
      data += chunk
    })
    res.on('end', () => {
      if (res.statusCode !== 200)
        return cb(data, null)
      return cb(null, data)
    })
    res.on('error', (err) => errorCb(err))
  })
  req.on('error', (err) => errorCb(err))
  req.end()
}

function awaitFor(begin, stop, fn, treatResFn, cb) {
  if (begin > stop) return cb()
  fn(begin, (err, res) => {
    if (err) return cb(err)
    treatResFn(JSON.parse(res))
    awaitFor(begin + 1, stop, fn, treatResFn, cb)
  })
}

function getPageFn(reqUrl, total) {
  return function(nb, cb) {
    console.log(`request ${nb}/${total === undefined ? 'unknown' : total.toString()}`)
    req(reqUrl.replace('&&&NO_PAGE&&&', nb), 'GET', (err, page) => {
      if (err) return cb(err)
      return cb(null, page)
    })
  }
}

function commonFetchLastFm(uri, getTotalPagesFn, getContentFn, cb) {
  getPageFn(uri)(1, (err, res) => {
    if (err) return cb(err)
    const page = JSON.parse(res)
    const totalPages = getTotalPagesFn(page)
    let pages = getContentFn(page)
    awaitFor(2, totalPages, getPageFn(uri, totalPages), page => pages = pages.concat(getContentFn(page)), (err) => {
      if (err) return cb(err)
      return cb(null, pages)
    })
  })
}

function getLastfmAlbums(cb) {
  if (relative.exists('savelastfmalbums.json')) {
    return cb(null, relative.jsonRead('savelastfmalbums.json'))
  }
  console.log('fetching lastfm albums')
  commonFetchLastFm(lastfmTopAlbums,
      page => page.topalbums['@attr'].totalPages,
      page => page.topalbums.album,
    (err, res) => {
      if (err) return cb(err)
      res = res.filter((el) => el.playcount >= minPlayCountAlbum)
      relative.jsonSave(res, 'savelastfmalbums.json')
      cb(null, res)
    })
}

function getLastfmArtist(cb) {
  if (relative.exists('savelastfmartists.json')) {
    return cb(null, relative.jsonRead('savelastfmartists.json'))
  }
  console.log('fetching lastfm artists')
  commonFetchLastFm(lastfmTopArtists, page => page.topartists['@attr'].totalPages, page => page.topartists.artist, (err, res) => {
    if (err) return cb(err)
    relative.jsonSave(res, 'savelastfmartists.json')
    return cb(null, res)
  })
}

function commonSearchDeezer(reqUrl, cb) {
  req(reqUrl, 'GET', (err, res) => {
    if (err) {
      console.error(`${reqUrl} has caused an error for the deezer api, skip this artist / album`)
      return cb(null, null)
    }
    const data = JSON.parse(res).data
    if (data === undefined || data[0] === undefined) {
      console.error(`${reqUrl} has not found anything in deezer: the artist or album is not present on deezer`)
      return cb(null, null)
    }
    const shouldBeTheOne = data[0]
    return cb(null, shouldBeTheOne.id)
  })
}

function searchDeezerArtist(name, cb) {
  commonSearchDeezer(deezerArtistSearch.replace('&&&KEYWORD&&&', `artist:"${name}"`), cb)
}

function searchDeezerAlbum(name, cb) {
  commonSearchDeezer(deezerAlbumSearch.replace('&&&KEYWORD&&&', `album:"${name}"`), cb)
}

function commonGetDeezerId(lastfmData, getIdFn, cb) {
  let ids = []
  awaitFor(0, lastfmData.length - 1,
    (idx, cb) => {
      console.log(`${idx}/${lastfmData.length} done`)
      getIdFn(lastfmData[idx], cb)
    },
    (res) => { if (res) ids.push(res) },
    (err) => {
      if (err) return cb(err)
      cb(null, ids)
    }
  )
}

function getDeezerAlbumsId(lastfmAlbums, cb) {
  if (relative.exists('savedeezeralbumsid.json')) {
    return cb(null, relative.jsonRead('savedeezeralbumsid.json'))
  }
  commonGetDeezerId(lastfmAlbums,
    (album, cb) => searchDeezerAlbum(album.name, cb),
    (err, albumsId) => {
      if (err) return cb(err)
      relative.jsonSave(albumsId, 'savedeezeralbumsid.json')
      cb(null, albumsId)
    })
}

function getToken(code, cb) {
  const finalUri = deezerTokenUri.replace('&&&CODE&&&', code)
  specificHttpsProxyReq(finalUri, (err, res) => {
    if (err) {
      console.error(err)
      return cb(err)
    }
    cb(null, JSON.parse(res).access_token)
  })
}

function postOneAlbum(albumId, token, cb) {
  const finalUri = deezerFavAlbumUri.replace('&&&ALBUM_ID&&&', albumId) + token
  req(finalUri, 'GET', (err, res) => {
    if (err) {
      console.error('problem with album: ' + albumId)
      return cb(null, 'false')
    }
    if (res !== 'true') {
      console.error('cannot add album: ' + albumId)
      return cb(null, 'false')
    }
    cb(null, res)
  })
}

function postAllAlbums(albumsId, token, cb) {
  const allResult = []
  awaitFor(0, albumsId.length - 1,
    (idx, cb) => postOneAlbum(albumsId[idx], token, cb),
    (res) => allResult.push(res),
    (err) => {
      if (err) return cb(err)
      cb(null, allResult)
    })
}

oauth.getCode((err, code) => {
  getLastfmAlbums((err, albums) => {
    if (err) console.error(err)
    else {
      getDeezerAlbumsId(albums, (err, albumsId) => {
        if (err) console.error(err)
        else {
          getToken(code, (err, token) => {
            postAllAlbums(albumsId, token, (err, res) => {
              if (err) console.error(err)
              else {
                console.log(`${res.filter((el) => el === 'false').length}/${res.length} not added`)
              }
            })
          })
        }
      })
    }
  })
})
