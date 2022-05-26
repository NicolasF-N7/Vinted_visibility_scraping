// puppeteer-extra is a drop-in replacement for puppeteer,
// it augments the installed puppeteer with plugin functionality.
// Any number of plugins can be added through `puppeteer.use()`
const puppeteer = require('puppeteer-extra')
const fs = require('fs')
const args = process.argv.slice(2);
let config = null;
if(args.length > 0){config = require(args[0]);}
else{config = require('./config.json');}
const nbPosts = config.postsURL.length;

// Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

// Add adblocker plugin to block all ads and trackers (saves bandwidth)
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker')
puppeteer.use(AdblockerPlugin({ blockTrackers: true }))

//==========Check the scraper hasn't already run today==========
// Get today's date
let allDashRegexp = /-/g;
let today = new Date().toISOString().slice(0, 10).replace(allDashRegexp,'/');
let newDataLine = today + ",";
//Get last run from file
const data = fs.readFileSync(config.dataFilePath, 'UTF-8');
const lines = data.split(/\r?\n/);
let lastLine = lines[lines.length - 2];
let lastScrapRun = lastLine.substring(0,10);

//Stop here if already ran today
if(lastScrapRun == today){
	console.log("Scrapper has already run today!");
	return;
}

//==========LAUNCH PUPPETEER===========
// That's it, the rest is puppeteer usage as normal 😊
puppeteer.launch({ headless: false, defaultViewport: null, args:['--start-minimized'] }).then(async browser => {
	//=========Start Browser=========
	const page = await browser.newPage()
  const navigationPromise = page.waitForNavigation()
  await page.setViewport({
    width: 1366,
    height: 568,
    deviceScaleFactor: 1,
  });
	//====Inject cookies + Go to /sell page====
	const cookies = fs.readFileSync(config.cookiesFilePath, 'utf8');
	const deserializedCookies = JSON.parse(cookies);
	await page.setCookie(...deserializedCookies);

	//===Visit All posts, and retrieve #Views + #Fav===
	//Create a line (newDataLine) with as much elements (views, fav) as there are URL in the config file
	for(let i=0; i < nbPosts; i++){
		let url = config.postsURL[i];
		let name = url.substring(url.lastIndexOf('/')+1, url.length);
		let cleanedName = name.replace(/[\d]/g, '').replace(/[-]/g, ' '); // cleaning digits from URL
		console.log("Visiting " + cleanedName);

		//===Connectivity trial===
		let connectionSuccess = false;
		let nbTrials = 0;
		while(nbTrials < config.connectionMaxTrial && !connectionSuccess){
			try{
				await page.goto(url, {waitUntil : 'domcontentloaded'});
				connectionSuccess = true;
			}catch(err){
				console.log("NO INTERNET. Trying again in 15 sec");
				await page.waitForTimeout(15000);
			}
			nbTrials++;
		}
		if(nbTrials > 1){console.log("Internet is baaack!");}

		//===Retrieve #View & #Fav===
		//Get the container element of data about the cloth (right square on the page)
		try{
			// IF ITEM SOLD: waitForSelector will throw TimeoutError
			await page.waitForSelector('div.details-list--main-info');
			const dataList = await page.$$('div.details-list--main-info div.details-list__item');
			//Iterate through data items to find Views and Fav
			for(const dataListItem of dataList) {
				let titleElem = await dataListItem.$('.details-list__item-title');
				if(titleElem != null){
					let titleText = await titleElem.evaluate(el => el.textContent);

					if(titleText == "Nombre de vues"){
						let nbViews = await dataListItem.$eval('.details-list__item-value', el => el.textContent);
						newDataLine += nbViews + ',';
						console.log("# Views : " + nbViews);
					}
					else if(titleText == "Articles favoris"){
						let nbFav = await dataListItem.$eval('.details-list__item-value', el => el.textContent);
						newDataLine += nbFav + ',';
						console.log("# Fav : " + nbFav);
					}
				}
			}
		}catch(err){
			newDataLine += '-,-,';
			console.log("Item sold");
		}

	}

	newDataLine += '\n';

	//===Append the new data to the excel===
	fs.appendFile(config.dataFilePath, newDataLine, 'utf8', (err) => {
	  if (err)
	    console.log(err);
	  else {
	    console.log("Data scraping done!\n");
	  }
	});
	browser.close();

})
