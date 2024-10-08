const Path = require('path')
const globals = require('../globals')
const fs = require('../../libs/fsExtra')
const Logger = require('../../Logger')
const Archive = require('../../libs/libarchive/archive')
const { xmlToJSON } = require('../index')
const parseComicInfoMetadata = require('./parseComicInfoMetadata')

/**
 *
 * @param {string} filepath
 * @returns {Promise<Buffer>}
 */
async function getComicFileBuffer(filepath) {
  if (!(await fs.pathExists(filepath))) {
    Logger.error(`[parseComicMetadata] Comic path does not exist "${filepath}"`)
    return null
  }
  try {
    return fs.readFile(filepath)
  } catch (error) {
    Logger.error(`[parseComicMetadata] Failed to read comic at "${filepath}"`, error)
    return null
  }
}

/**
 * Extract cover image from comic return true if success
 *
 * @param {string} comicPath
 * @param {string} comicImageFilepath
 * @param {string} outputCoverPath
 * @returns {Promise<boolean>}
 */
async function extractCoverImage(comicPath, comicImageFilepath, outputCoverPath) {
  const comicFileBuffer = await getComicFileBuffer(comicPath)
  if (!comicFileBuffer) return null

  let archive = null
  try {
    archive = await Archive.open(comicFileBuffer)
    const fileEntry = await archive.extractSingleFile(comicImageFilepath)

    if (!fileEntry?.fileData) {
      Logger.error(`[parseComicMetadata] Invalid file entry data for comicPath "${comicPath}"/${comicImageFilepath}`)
      return false
    }

    await fs.writeFile(outputCoverPath, fileEntry.fileData)

    return true
  } catch (error) {
    Logger.error(`[parseComicMetadata] Failed to extract image "${comicImageFilepath}" from comicPath "${comicPath}" into "${outputCoverPath}"`, error)
    return false
  } finally {
    // Ensure we free the memory
    archive?.close()
  }
}
module.exports.extractCoverImage = extractCoverImage

/**
 * Parse metadata from comic
 *
 * @param {import('../../models/Book').EBookFileObject} ebookFile
 * @returns {Promise<import('./parseEbookMetadata').EBookFileScanData>}
 */
async function parse(ebookFile) {
  const comicPath = ebookFile.metadata.path
  Logger.debug(`Parsing metadata from comic at "${comicPath}"`)

  const comicFileBuffer = await getComicFileBuffer(comicPath)
  if (!comicFileBuffer) return null

  let archive = null
  try {
    archive = await Archive.open(comicFileBuffer)

    const fileObjects = await archive.getFilesArray()

    fileObjects.sort((a, b) => {
      return a.file.name.localeCompare(b.file.name, undefined, {
        numeric: true,
        sensitivity: 'base'
      })
    })

    let metadata = null
    const comicInfo = fileObjects.find((fo) => fo.file.name === 'ComicInfo.xml')
    if (comicInfo) {
      const comicInfoEntry = await comicInfo.file.extract()
      if (comicInfoEntry?.fileData) {
        const comicInfoStr = new TextDecoder().decode(comicInfoEntry.fileData)
        const comicInfoJson = await xmlToJSON(comicInfoStr)
        if (comicInfoJson) {
          metadata = parseComicInfoMetadata.parse(comicInfoJson)
        }
      }
    }

    const payload = {
      path: comicPath,
      ebookFormat: ebookFile.ebookFormat,
      metadata
    }

    const firstImage = fileObjects.find((fo) => globals.SupportedImageTypes.includes(Path.extname(fo.file.name).toLowerCase().slice(1)))
    if (firstImage?.file?._path) {
      payload.ebookCoverPath = firstImage.file._path
    } else {
      Logger.warn(`[parseComicMetadata] Cover image not found in comic at "${comicPath}"`)
    }

    return payload
  } catch (error) {
    Logger.error(`[parseComicMetadata] Failed to parse comic metadata at "${comicPath}"`, error)
    return null
  } finally {
    // Ensure we free the memory
    archive?.close()
  }
}
module.exports.parse = parse
