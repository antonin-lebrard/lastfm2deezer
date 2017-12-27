'use strict'

const http = require("http")
const url = require("url")
const fs = require('fs')

const oauth = require('./oauth')
const relative = require('./relative')

const user = '',
    lastfmApiKey = ''

const lastfmUri = 'http://ws.audioscrobbler.com/2.0/?method=user.&&&METHOD&&&&user=&&&USER&&&&api_key=&&&API_KEY&&&&page=&&&NO_PAGE&&&&format=json'
const lastfmTopAlbums = lastfmUri
    .replace('&&&METHOD&&&', 'gettopalbums')
    .replace('&&&USER&&&', user)
    .replace('&&&API_KEY&&&', lastfmApiKey)
const lastfmTopArtists = lastfmUri
    .replace('&&&METHOD&&&', 'gettopartits')
    .replace('&&&USER&&&', user)
    .replace('&&&API_KEY&&&', lastfmApiKey)

const deezerFavAlbumUri = 'http://api.deezer.com/user/me/albums/?request_method=manage_library&album_id=&&&ALBUM_ID&&&'
const deezerFavArtistUri = 'http://api.deezer.com/user/me/artists/?request_method=manage_library&artist_id=&&&ARTIST_ID&&&'
const deezerSearchUri = 'http://api.deezer.com/search/&&&TYPE&&&?q=&&&KEYWORD&&&&strict=on',
    deezerArtistSearch = deezerSearchUri.replace('&&&TYPE&&&', 'artist'),
    deezerAlbumSearch = deezerSearchUri.replace('&&&TYPE&&&', 'album')

function optProxy(baseOpt) {
  return {
    host: "proxy ip here",
    port: "proxy port here",
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
  const isBehindProxy = true /// If not behind proxy, change to false
  if (isBehindProxy) {
    opt = optProxy(opt)
  }
  let req = http.request(opt, res => {
    console.log(`${uri}: ${res.statusCode}`);
    res.setEncoding('utf8')
    let data = ''
    res.on('data', chunk => {
      data += chunk
    })
    res.on('end', () => cb(null, data))
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
    if (err) return cb(err)
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

oauth.getCode((err, code) => {
  getLastfmAlbums((err, albums) => {
    if (err) console.error(err)
    else {
      getDeezerAlbumsId(albums, (err, albumsId) => {
        if (err) console.error(err)
        else {
          console.log('something done')
        }
      })
    }
  })
})
