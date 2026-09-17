const axios = require("axios");
const fs = require("fs");
require("dotenv").config();
const archiver = require("archiver");
const path = require("path");

if (!process.env.WK_API_TOKEN) {
    console.log("No API token");
    return;
}

const config = {
    headers: {
        Authorization: `Bearer ${process.env.WK_API_TOKEN}`,
    },
};

async function wait(time) {
    return new Promise((res, rej) => setTimeout(res, time));
}

async function getItems() {
    let items = [];
    let url = "https://api.wanikani.com/v2/subjects?page_after_id=0";
    while (url) {
        console.log(`Fetching ${url}`);
        let data = await fetchWithRetry(url);
        items = items.concat(data.data.data);
        url = data.data.pages.next_url;
        await wait(1000);
    }
    return items;
}

async function fetchWithRetry(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await axios.get(url, config);
        } catch (err) {
            if (attempt === retries) throw err;
            console.log(`Fetch failed (attempt ${attempt}): ${err.code || err.message}. Retrying...`);
            await wait(5000 * attempt);
        }
    }
}

async function updateWKItems() {
    let items = await getItems();

    // Only write if there have been changes
    let last_update = fs.readFileSync(
        path.resolve(__dirname, "./last_update.txt"),
        "utf8",
    );
    console.log(`Last update was at ${last_update}`);
    for (let item of items) {
        // if (item.data.level == 13)
        // {
        //     console.log(`${JSON.stringify(item)}`)
        // }
        if (item.data_updated_at > last_update && item.object != "radical") {
            console.log(`Update required. Last update of ${item.object}: ${item.data.characters} was at ${item.data_updated_at}`);
            return write_update(items);
        }
    }
    console.log(`No further update required`);
    return false;
   
}

function writeIfChanged(filePath, newContent, handler) {
    let oldContent = null;
    oldContent = fs.readFileSync(filePath, "utf-8");

    if (oldContent === newContent) {
        return false;
    }

    fs.writeFileSync(filePath, newContent, "utf-8", handler);
    return true;
}

function write_update(items){
    let kanji = items
        .filter((a) => a.object == "kanji" && a.data.hidden_at == null)
        .map((a) => `    ["${a.data.characters}", "freq", ${a.data.level}]`);
    let vocab = items
        .filter((a) => a.object == "vocabulary" && a.data.hidden_at == null)
        .map((a) => `["${a.data.characters}", "freq", ${a.data.level}]`);
    let kanjiText = `[\n${kanji.join(",\n")}\n]`;
    let vocabText = `[\n${vocab.join(",\n")}\n]`;
    const errorHandler = (err) => (err ? console.error(err) : undefined);

    const kanjiChanged = writeIfChanged(`${__dirname}/kanji.json`, kanjiText, errorHandler);
    const vocabChanged = writeIfChanged(`${__dirname}/vocab.json`, vocabText, errorHandler);
    const dataChanged = kanjiChanged || vocabChanged;
    const revision = new Date().toISOString();
    fs.writeFile(
        `${__dirname}/last_update.txt`,
        revision,
        "utf-8",
        errorHandler,
    );
    // Only publish new version of dictionary if there are actual changes.
    if (dataChanged) {
        update_revision(revision);
        console.log(`New level changes detected. Publishing new revision.`);
    } else {
        console.log(`No content changes to levels found. Stopping update.`);
    }
    return dataChanged;
}

function update_revision(revision) {
  const template = fs.readFileSync(`${__dirname}/index_format.json`, 'utf8');
  const filled = template.replace('"__REVISION__"', JSON.stringify(revision));
  // Sanity check: make sure the result is valid JSON before writing it out
  const parsed = JSON.parse(filled);
  fs.writeFileSync(`${__dirname}/index.json`, filled, 'utf8');
}

function zip() {
    const output = fs.createWriteStream(
        path.join(__dirname, "../../dicts/yomichan_wk_level_tags.zip"),
    );
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(output);
    archive.file(`${__dirname}/index.json`, {
        name: "index.json",
    });
    archive.file(`${__dirname}/kanji.json`, {
        name: "kanji_meta_bank_1.json",
    });
    archive.file(`${__dirname}/vocab.json`, {
        name: "term_meta_bank_1.json",
    });
    archive.finalize();
}

async function main() {
    if (await updateWKItems()){
        zip();
        console.log(`Finished updating`);
    }
}

main();
