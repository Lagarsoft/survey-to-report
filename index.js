require("dotenv").config()

const fs = require("fs").promises
const path = require("path")
const process = require("process")
const { authenticate } = require("@google-cloud/local-auth")
const { google } = require("googleapis")
const OpenAI = require("openai")

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), "token.json")
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json")

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH)
    const credentials = JSON.parse(content)
    return google.auth.fromJSON(credentials)
  } catch (err) {
    return null
  }
}

/**
 * Serializes credentials to a file comptible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH)
  const keys = JSON.parse(content)
  const key = keys.installed || keys.web
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  })
  await fs.writeFile(TOKEN_PATH, payload)
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist()
  if (client) {
    return client
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  })
  if (client.credentials) {
    await saveCredentials(client)
  }
  return client
}

/**
 * Reads the content of our sample spreadsheet:
 * @see https://docs.google.com/spreadsheets/d/1jLJbLdSc4F1Hdcs8zROGGr1okU_ELYfrVBc_ZRq3QQM/edit
 */
async function readSheetAndGenerateSummary(auth) {
  // Read first two rows of the sample spreadsheet, where our data is located
  const sheets = google.sheets({ version: "v4", auth })
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env["SPREADSHEETID"],
    range: "Form Responses 1!A1:Z2",
  })
  const rows = res.data.values
  if (!rows || rows.length === 0) {
    console.log("No data found.")
    return
  }

  // Method to prompt openAI chatbot
  const generateSummaryUsingLLM = async (prompt) => {
    const stream = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      stream: true,
    })
    for await (const chunk of stream) {
      process.stdout.write(chunk.choices[0]?.delta?.content || "")
    }
  }

  // Parse questions and answers from our spreadsheet
  const questions = rows[0].filter((row) => row).slice(1)
  const answers = rows[1].filter((row) => row).slice(1)

  let text = ""
  for (let i = 0; i <= questions.length - 1; i++) {
    text += `${questions[i]} ${answers[i]}`
  }

  // Create prompt
  const prompt = `Given the following questions and answers between angle brackets given by an architect who performed the inspection of a building, draft a Building Envelope Assesment Report with an introduction, body and conclusion. Questions and answers:\n<${text}>`

  generateSummaryUsingLLM(prompt)
}

authorize().then(readSheetAndGenerateSummary).catch(console.error)
