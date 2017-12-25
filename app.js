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

function req(uri, method, cb) {
  let errorCbCalled = false
  function errorCb(err) {
    if (!errorCbCalled) {
      errorCbCalled = true
      cb(err)
    }
  }
  const { protocol, hostname, path } = url.parse(uri)
  const opt = {
    protocol,
    hostname,
    path,
    method: method
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
  commonFetchLastFm(lastfmTopAlbums, page => page.topalbums['@attr'].totalPages, page => page.topalbums.album, (err, res) => {
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
    const shouldBeTheOne = data[0]
    if (shouldBeTheOne === undefined) {
      console.error(`${reqUrl} has not found anything in deezer: the artist or album is not present on deezer`)
      return cb(null, null)
    }
    return cb(null, shouldBeTheOne.id)
  })
}

function searchDeezerArtist(name, cb) {
  commonSearchDeezer(deezerArtistSearch.replace('&&&KEYWORD&&&', `artist:"${name}"`), cb)
}

function searchDeezerAlbum(name, cb) {
  commonSearchDeezer(deezerAlbumSearch.replace('&&&KEYWORD&&&', `album:"${name}"`), cb)
}

oauth.getCode((err, code) => {
  getLastfmAlbums((err, albums) => {
    if (err) console.error(err)
    else {
      let albumsId = []
      awaitFor(0, albums.length,
        (idx, cb) => searchDeezerAlbum(albums[idx].name, cb),
        (res) => { if (res) albumsId.push(res) },
        (err) => {
          if (!err) {
            relative.jsonSave(albumsId, 'savedeezeralbumsid.json')
          }
        }
      )
    }
  })
})
