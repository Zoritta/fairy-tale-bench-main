const serverName = "http://192.168.0.40";
const audioEndpoint = `${serverName}/axis-cgi/mediaclip.cgi`;
const listEndpoint = `${serverName}/axis-cgi/param.cgi?action=list&group=MediaClip`;
let audioClips = [];
let currentVolume = 50;
let currentPlayingClipId = null;
let volumeChangeTimeout = null;
const volumeSlider = document.getElementById("volumeSlider");
const sliderTrack = document.getElementById("sliderTrack");

// Maximum file size in bytes (e.g., 10 MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed file types
const ALLOWED_FILE_TYPES = ["audio/mp3", "audio/wav", "audio/mpeg"];

let digestAuth = {
  username: "root",
  password: "pass",
  nonce: null,
  realm: null,
  qop: null,
  nc: "00000001", // Nonce count
  cnonce: null, // Client nonce
  uri: null,
  response: null,
};

// Function to create the Digest Authorization header
function createDigestHeader(method, uri) {
  const ha1 = CryptoJS.MD5(
    `${digestAuth.username}:${digestAuth.realm}:${digestAuth.password}`
  ).toString();
  const ha2 = CryptoJS.MD5(`${method}:${uri}`).toString();
  digestAuth.response = CryptoJS.MD5(
    `${ha1}:${digestAuth.nonce}:${digestAuth.nc}:${digestAuth.cnonce}:${digestAuth.qop}:${ha2}`
  ).toString();

  return `Digest username="${digestAuth.username}", realm="${digestAuth.realm}", nonce="${digestAuth.nonce}", uri="${uri}", response="${digestAuth.response}", qop=${digestAuth.qop}, nc=${digestAuth.nc}, cnonce="${digestAuth.cnonce}"`;
}

// Function to parse the Digest Authentication header
function parseDigestAuth(wwwAuthenticateHeader) {
  if (!wwwAuthenticateHeader) {
    console.error("No WWW-Authenticate header found!");
    return null;
  }

  if (!wwwAuthenticateHeader.startsWith("Digest")) {
    console.error("Unsupported authentication type:", wwwAuthenticateHeader);
    return null;
  }

  const authFields = wwwAuthenticateHeader
    .substring(7)
    .split(", ")
    .reduce((acc, current) => {
      const [key, value] = current.split("=");
      acc[key] = value.replace(/"/g, "");
      return acc;
    }, {});

  return authFields;
}

// Function to generate a client nonce
function generateCNonce() {
  return Math.random().toString(36).substring(2, 15);
}

// Function to display messages
function displayMessage(message) {
  const messageArea = document.getElementById("messageArea");
  messageArea.textContent = message;
  messageArea.style.display = "block";
  setTimeout(() => {
    messageArea.style.display = "none";
  }, 5000);
}

// Function to make a GET request with Digest Authentication using Fetch
async function makeGetRequest(url) {
  try {
    // First request to get the nonce and other parameters
    let response = await fetch(url, {
      method: "GET",
      credentials: "include", // Ensures cookies and credentials are sent
    });

    if (response.status === 401) {
      const authHeader = response.headers.get("WWW-Authenticate");
      if (authHeader) {
        const authParams = parseDigestAuth(authHeader);
        if (authParams) {
          digestAuth.nonce = authParams.nonce;
          digestAuth.realm = authParams.realm;
          digestAuth.qop = authParams.qop;
          digestAuth.cnonce = generateCNonce();
          digestAuth.nc = (parseInt(digestAuth.nc, 16) + 1)
            .toString(16)
            .padStart(8, "0");

          // Retry the request with the updated Digest header
          response = await fetch(url, {
            method: "GET",
            headers: {
              Authorization: createDigestHeader("GET", url),
            },
          });
        }
      }
    }

    if (response.ok) {
      const data = await response.text();
      console.log("Received response: ", data);
      return data;
    } else {
      throw new Error(`Request failed with status: ${response.status}`);
    }
  } catch (error) {
    console.error("Error during fetch request:", error);
  }
}

// Function to list audio files
async function listAudioFiles() {
  console.log("Starting to list audio files...");

  try {
    const responseText = await makeGetRequest(listEndpoint);
    console.log("Received data from the server: ", responseText);
    const clips = [];
    const lines = responseText.split("\n");
    const clipMap = {};

    lines.forEach((line) => {
      if (line.startsWith("root.MediaClip.M")) {
        const parts = line.split("=");
        const key = parts[0].trim();
        const value = parts[1].trim();
        const [prefix, mediaClip, id, property] = key.split(".");
        const clipId = parseInt(id.substring(1), 10);

        if (!clipMap[clipId]) {
          clipMap[clipId] = { id: clipId };
        }

        if (property === "Location") {
          clipMap[clipId].location = value;
        } else if (property === "Name") {
          clipMap[clipId].name = value;
          console.log("Clip Name:", value); // Debug line
        } else if (property === "Type") {
          clipMap[clipId].type = value;
        }
      }
    });

    for (const clipId in clipMap) {
      if (
        clipMap.hasOwnProperty(clipId) &&
        clipMap[clipId].type === "audio" &&
        clipId < 36 &&
        clipId !== "0" && // Exclude ID 0
        clipId !== "1" // Exclude ID 1
      ) {
        clips.push(clipMap[clipId]);
      }
    }

    audioClips = clips; // Store the clips globally for later access
    console.log("Finished processing clips. Total clips found: ", clips.length);
    console.log("Clips: ", clips);

    // Update the audio list UI with the fetched clips
    updateAudioListUI(clips);
  } catch (error) {
    console.error("Error listing audio files:", error);
    displayMessage("Error listing audio files: " + error);
  }
}
// Function to update the UI with audio clips
function updateAudioListUI(clips) {
  const list = document.getElementById("audioList");
  list.innerHTML = "";
  console.log("Updating UI with audio clips...");

  clips.forEach((clip) => {
    if (clip) {
      const li = document.createElement("li");
      li.textContent = `${clip.name || "Unnamed Clip"}`;
      const threeDots = document.createElement("span");
      threeDots.textContent = "⋮";
      threeDots.className = "three-dots";
      threeDots.onclick = () => toggleDropdownMenu(li);
      li.appendChild(threeDots);

      const dropdownMenu = document.createElement("div");
      dropdownMenu.className = "dropdown-menu";

      const playButton = document.createElement("button");
      playButton.textContent = "Play";
      playButton.onclick = () => playAudio(clip.id);
      dropdownMenu.appendChild(playButton);

      const deleteButton = document.createElement("button");
      deleteButton.textContent = "Delete";
      deleteButton.onclick = () => deleteAudio(clip.id);
      dropdownMenu.appendChild(deleteButton);

      const renameButton = document.createElement("button");
      renameButton.textContent = "Rename";
      renameButton.onclick = () => renameAudio(clip.id);
      dropdownMenu.appendChild(renameButton);

      const stopButton = document.createElement("button");
      stopButton.textContent = "Stop";
      stopButton.onclick = () => stopAudio();
      dropdownMenu.appendChild(stopButton);

      li.appendChild(dropdownMenu);

      li.onmouseleave = () => {
        dropdownMenu.style.display = "none";
      };

      list.appendChild(li);
      console.log("Added clip to UI:", clip.name);
    }
  });

  console.log("UI update complete.");
}

// Function to toggle the dropdown menu
function toggleDropdownMenu(li) {
  const dropdownMenus = document.querySelectorAll(".dropdown-menu");
  dropdownMenus.forEach((menu) => {
    if (menu !== li.querySelector(".dropdown-menu")) {
      menu.style.display = "none";
    }
  });

  const dropdownMenu = li.querySelector(".dropdown-menu");
  dropdownMenu.style.display =
    dropdownMenu.style.display === "block" ? "none" : "block";
}

// Function to play audio
function playAudio(clipId) {
  const url = `${audioEndpoint}?action=play&clip=${clipId}`;

  makeGetRequest(url)
    .then((response) => {
      if (response) {
        console.log("Audio started successfully:", response);
        displayMessage("Playing clip: " + clipId);
        currentPlayingClipId = clipId; // Update the currentPlayingClipId when the audio starts
      } else {
        console.error("Failed to play audio.");
        displayMessage("Failed to play audio.");
      }
    })
    .catch((error) => {
      console.error("Error playing audio:", error);
      displayMessage("Error playing audio: " + error);
    });
}

// Function to delete audio
function deleteAudio(clipId) {
  const url = `${audioEndpoint}?action=remove&clip=${clipId}`;
  console.log("Deleting audio with Clip ID: ", clipId);
  displayMessage("Deleting audio with Clip ID: " + clipId);

  makeGetRequest(url)
    .then((response) => {
      console.log("Deleted:", response);
      displayMessage("Deleted: " + response);
      listAudioFiles(); // Refresh the audio list
    })
    .catch((error) => {
      console.error("Error deleting audio:", error);
      displayMessage("Error deleting audio: " + error);
    });
}
//Function to stop audio
function stopAudio() {
  return new Promise((resolve, reject) => {
    const url = `${audioEndpoint}?action=stop`;
    console.log("Stopping audio...");
    displayMessage("Stopping audio...");

    makeGetRequest(url)
      .then((response) => {
        console.log("Stopped:", response);
        displayMessage("Stopped: " + response);

        resolve(response); // Resolve the promise with the response
      })
      .catch((error) => {
        console.error("Error stopping audio:", error);
        displayMessage("Error stopping audio: " + error);
        reject(error); // Reject the promise with the error
      });
  });
}

// Event listener for stop button
document.getElementById("stopButton").addEventListener("click", function () {
  stopAudio(); // Call the stopAudio function when the button is clicked
});

// Function to rename audio
function renameAudio(clipId) {
  const newName = prompt("Enter the new name for the clip:");
  if (!newName) {
    return;
  }

  const url = `${audioEndpoint}?action=update&clip=${clipId}&name=${encodeURIComponent(
    newName
  )}`;
  console.log("Renaming audio with Clip ID: ", clipId, " to ", newName);
  displayMessage("Renaming audio with Clip ID: " + clipId + " to " + newName);

  makeGetRequest(url)
    .then((response) => {
      console.log("Renamed:", response);
      displayMessage("Renamed: " + response);
      listAudioFiles(); // Refresh the audio list
    })
    .catch((error) => {
      console.error("Error renaming audio:", error);
      displayMessage("Error renaming audio: " + error);
    });
}
function changeVolume(newVolume) {
  // Ensure the volume is within the allowed range (0 to 1000)
  newVolume = Math.max(0, Math.min(1000, newVolume));

  console.log("Preparing to change volume to:", newVolume);
  displayMessage("Changing volume to: " + newVolume);

  // Check if there is a currently playing clip
  if (currentPlayingClipId !== null && currentPlayingClipId !== undefined) {
    console.log(
      "Audio is playing. Stopping audio for clip:",
      currentPlayingClipId
    );

    // Call stopAudio and then play audio with new volume after it's stopped
    stopAudio()
      .then(() => {
        // After stopping audio, play with the new volume
        playAudioWithNewVolume(newVolume, currentPlayingClipId);
      })
      .catch((error) => {
        console.error("Failed to stop audio:", error);
        displayMessage("Failed to stop audio, cannot change volume.");
      });
  } else {
    // No audio is currently playing, show a message to the user
    console.warn("No audio is playing. Cannot change volume.");
    displayMessage("First play a song, then change the volume.");
  }
}

// Helper function to play audio with the new volume
function playAudioWithNewVolume(newVolume, clipId) {
  if (volumeChangeTimeout) {
    clearTimeout(volumeChangeTimeout);
  }

  volumeChangeTimeout = setTimeout(() => {
    const url = `${audioEndpoint}?action=play&clip=${clipId}&volume=${newVolume}`;
    console.log("Requesting volume change with URL:", url);

    makeGetRequest(url)
      .then((response) => {
        if (response) {
          console.log("Volume change response:", response);
          displayMessage("Volume changed: " + response);
          currentVolume = newVolume; // Update current volume
        } else {
          console.error("Failed to change volume, no response.");
          displayMessage("Failed to change volume, no response.");
        }
      })
      .catch((error) => {
        console.error("Error changing volume:", error);
        displayMessage("Error changing volume: " + error);
      });
  }, 500);
}

// Event listener for the volume slider
volumeSlider.addEventListener("input", function () {
  const newVolume = this.value * 10; // Convert slider value (0-100) to (0-1000)
  sliderTrack.style.width = `${this.value}%`; // Update the visual slider track
  changeVolume(newVolume); // Call the changeVolume function
});

// Added Function: Retry for Stale Nonce
async function makeAuthenticatedRequest(url, method = "GET", body = null) {
  let retryCount = 0;
  let success = false;
  let result = null;

  while (!success && retryCount < 2) {
    try {
      let response = await fetch(url, {
        method,
        credentials: "include", // Sends credentials and cookies
        body,
      });

      if (response.status === 401) {
        const authHeader = response.headers.get("WWW-Authenticate");
        if (authHeader) {
          const authParams = parseDigestAuth(authHeader);
          digestAuth.nonce = authParams.nonce;
          digestAuth.realm = authParams.realm;
          digestAuth.qop = authParams.qop;
          digestAuth.cnonce = generateCNonce();

          // Retry request with Digest Authentication header
          response = await fetch(url, {
            method,
            headers: {
              Authorization: createDigestHeader(method, url),
            },
            body,
          });
        }
      }

      if (response.ok) {
        result = await response.text();
        success = true;
      } else {
        retryCount++;
      }
    } catch (error) {
      console.error("Error during fetch request:", error);
    }
  }

  return result;
}
// Function to upload audio file
async function uploadAudio(file) {
  // Check the file type and size before uploading
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    displayMessage("Invalid file type. Please upload an MP3 or WAV file.");
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    displayMessage(
      "File is too large. Please upload a file smaller than 10 MB."
    );
    return;
  }

  // Extract the audio name from the input
  let audioName = document.getElementById("audioNameInput").value.trim();
  if (!audioName) {
    audioName = file.name.substring(0, file.name.lastIndexOf("."));
  }

  const formData = new FormData();
  formData.append("file", file); // Append the file to form data
  formData.append("name", audioName); // Append the audio name

  const uploadUrl = `${audioEndpoint}?action=upload&media=audio`;

  // Display message for the start of the upload
  displayMessage(`Uploading ${audioName}...`);

  try {
    // Make POST request to upload the file
    const response = await makeAuthenticatedRequest(
      uploadUrl,
      "POST",
      formData
    );

    if (response) {
      displayMessage(`Successfully uploaded: ${audioName}`);
      console.log("Upload successful. Response:", response);

      // Store the uploaded audio information
      const audioClip = {
        name: audioName,
        file: file,
        // other properties as needed (like ID or URL)
      };

      audioClips.push(audioClip); // Add to the audio clips array
      listAudioFiles(); // Refresh the audio list after upload
    } else {
      displayMessage("Upload failed. Please try again.");
    }
  } catch (error) {
    console.error("Error uploading file:", error);
    displayMessage("Error uploading file: " + error);
  }
}

// Function to play a random audio clip excluding IDs 0 and 1
function playRandomAudio() {
  // Filter out clips with IDs 0 and 1
  const filteredClips = audioClips.filter(
    (clip) => clip.id !== 0 && clip.id !== 1
  );

  if (filteredClips.length === 0) {
    displayMessage("No audio clips available to play.");
    return;
  }

  const randomIndex = Math.floor(Math.random() * filteredClips.length);
  const randomClip = filteredClips[randomIndex];

  if (randomClip) {
    playAudio(randomClip.id); // Reuse the existing playAudio function
    displayMessage(`Playing random audio: ${randomClip.name}`);
    console.log("Playing random clip:", randomClip.name);
  } else {
    displayMessage("Failed to select a random audio clip.");
  }
}

// Event listener for the random play button
document
  .getElementById("randomPlayButton")
  .addEventListener("click", playRandomAudio);

// Event listener for stop button
document.getElementById("stopButton").addEventListener("click", function () {
  if (currentPlayingClipId) {
    const currentAudioElement = document.getElementById(currentPlayingClipId); // Assuming your audio elements have IDs
    if (currentAudioElement) {
      currentAudioElement.pause(); // Pause the audio
      currentAudioElement.currentTime = 0; // Reset the audio to the beginning
    }
    currentPlayingClipId = null; // Optionally reset the ID
  }
});

// Event listener for file input change to display selected file name
document.getElementById("fileInput").addEventListener("change", function () {
  const fileName = this.files[0] ? this.files[0].name : "No file chosen";
  document.getElementById("fileName").textContent = fileName;
});

// Upload button click listener to handle file upload
document.getElementById("uploadButton").addEventListener("click", function () {
  const fileInput = document.getElementById("fileInput");
  const file = fileInput.files[0];

  if (!file) {
    displayMessage("Please select a file to upload.");
    return;
  }

  // Call the upload function with the selected file
  uploadAudio(file);
});

// Initialize by listing audio files
listAudioFiles();
