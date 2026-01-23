// Firebase Configuration and Authentication Module
// This module handles Firebase initialization, authentication, and Firestore operations

/* global getProjects, getBookmarks, saveBookmarks, saveProjects, renderCurrentView, updateSettingsAccountSection, getGoogleSettings, setGoogleSettings, getOpenAISettings, setOpenAISettings */

// Firebase configuration
const firebaseConfig = {
	apiKey: "AIzaSyAbGQLNf5DaihauUnZhVA03TAQUO_6PwZk",
	authDomain: "ourstuff-firebase.firebaseapp.com",
	projectId: "ourstuff-firebase",
	storageBucket: "ourstuff-firebase.firebasestorage.app",
	messagingSenderId: "450756988196",
	appId: "1:450756988196:web:89ee37877b306bbb1277b1",
	measurementId: "G-JR0JC5Z47E",
};

// Firebase instances
let firebaseApp = null;
let auth = null;
let db = null;
let currentUser = null;

// Collection names
const ARTIFICATES_COLLECTION = "artifacts";
const USER_PRIVATE_COLLECTION = "userPrivate";

// Encryption key cache (derived from user credentials)
let encryptionKey = null;

// ========== ULID Generator ==========

// Simple ULID generator for artifact IDs
function generateULID() {
	const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	const ENCODING_LEN = ENCODING.length;
	const TIME_LEN = 10;
	const RANDOM_LEN = 16;

	const now = Date.now();
	let str = "";

	// Encode timestamp (first 10 characters)
	let time = now;
	for (let i = TIME_LEN - 1; i >= 0; i--) {
		str = ENCODING[time % ENCODING_LEN] + str;
		time = Math.floor(time / ENCODING_LEN);
	}

	// Add random characters (last 16 characters)
	for (let i = 0; i < RANDOM_LEN; i++) {
		str += ENCODING[Math.floor(Math.random() * ENCODING_LEN)];
	}

	return str;
}

// ========== Encryption Functions ==========

// Derive an encryption key from the user's UID using PBKDF2
async function deriveEncryptionKey(userId) {
	const encoder = new TextEncoder();
	// Use the user's UID combined with a salt as the base for key derivation
	const salt = encoder.encode("ourstuff-firebase-salt-v1");
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		encoder.encode(userId),
		{ name: "PBKDF2" },
		false,
		["deriveKey"],
	);

	return await crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: salt,
			iterations: 100000,
			hash: "SHA-256",
		},
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

// Encrypt data using AES-GCM
async function encryptData(data, key) {
	const encoder = new TextEncoder();
	const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM

	const encrypted = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: iv },
		key,
		encoder.encode(JSON.stringify(data)),
	);

	// Combine IV and encrypted data, then base64 encode
	const combined = new Uint8Array(iv.length + encrypted.byteLength);
	combined.set(iv);
	combined.set(new Uint8Array(encrypted), iv.length);

	return btoa(String.fromCharCode(...combined));
}

// Decrypt data using AES-GCM
async function decryptData(encryptedBase64, key) {
	try {
		const combined = Uint8Array.from(atob(encryptedBase64), (c) =>
			c.charCodeAt(0),
		);
		const iv = combined.slice(0, 12);
		const encrypted = combined.slice(12);

		const decrypted = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: iv },
			key,
			encrypted,
		);

		const decoder = new TextDecoder();
		return JSON.parse(decoder.decode(decrypted));
	} catch (error) {
		console.error("Decryption failed:", error);
		return null;
	}
}

// Get or create the encryption key for the current user
async function getEncryptionKey(userId) {
	if (encryptionKey && currentUser && currentUser.uid === userId) {
		return encryptionKey;
	}
	encryptionKey = await deriveEncryptionKey(userId);
	return encryptionKey;
}

// ========== Firebase Initialization ==========

async function initializeFirebase() {
	if (firebaseApp) {
		return { app: firebaseApp, auth, db };
	}

	try {
		// Firebase is loaded via CDN in index.html
		if (typeof firebase === "undefined") {
			console.error("Firebase SDK not loaded");
			return null;
		}

		// Initialize Firebase
		firebaseApp = firebase.initializeApp(firebaseConfig);
		auth = firebase.auth();
		db = firebase.firestore();

		// Set up auth state listener
		auth.onAuthStateChanged(handleAuthStateChange);

		console.log("Firebase initialized successfully");
		return { app: firebaseApp, auth, db };
	} catch (error) {
		console.error("Firebase initialization error:", error);
		return null;
	}
}

// ========== Authentication ==========

function handleAuthStateChange(user) {
	currentUser = user;

	// Update UI based on auth state
	updateAuthUI();

	if (user) {
		console.log("User signed in:", user.uid);
		// Check for local data to sync
		checkAndSyncLocalData(user);
	} else {
		console.log("User signed out");
	}
}

function getCurrentUser() {
	return currentUser;
}

function isUserSignedIn() {
	return currentUser !== null;
}

// Sign in with email and password
async function signInWithEmail(email, password, recaptchaToken) {
	try {
		if (!auth) {
			await initializeFirebase();
		}

		// Verify reCAPTCHA token on the client side
		if (!recaptchaToken) {
			throw new Error("reCAPTCHA verification failed. Please try again.");
		}

		const result = await auth.signInWithEmailAndPassword(email, password);
		return { success: true, user: result.user };
	} catch (error) {
		console.error("Sign in error:", error);
		let errorMessage = "Sign in failed. Please try again.";

		// Provide user-friendly error messages
		switch (error.code) {
			case "auth/user-not-found":
				errorMessage = "No account found with this email. Please sign up.";
				break;
			case "auth/wrong-password":
				errorMessage = "Incorrect password. Please try again.";
				break;
			case "auth/invalid-email":
				errorMessage = "Invalid email address.";
				break;
			case "auth/user-disabled":
				errorMessage = "This account has been disabled.";
				break;
			case "auth/too-many-requests":
				errorMessage = "Too many failed attempts. Please try again later.";
				break;
			default:
				errorMessage = error.message;
		}

		return { success: false, error: errorMessage };
	}
}

// Sign up with email and password
async function signUpWithEmail(email, password, recaptchaToken) {
	try {
		if (!auth) {
			await initializeFirebase();
		}

		// Verify reCAPTCHA token on the client side
		if (!recaptchaToken) {
			throw new Error("reCAPTCHA verification failed. Please try again.");
		}

		// Validate password strength
		if (password.length < 6) {
			throw new Error("Password must be at least 6 characters long.");
		}

		const result = await auth.createUserWithEmailAndPassword(email, password);
		return { success: true, user: result.user };
	} catch (error) {
		console.error("Sign up error:", error);
		let errorMessage = "Sign up failed. Please try again.";

		// Provide user-friendly error messages
		switch (error.code) {
			case "auth/email-already-in-use":
				errorMessage = "An account already exists with this email. Please sign in.";
				break;
			case "auth/invalid-email":
				errorMessage = "Invalid email address.";
				break;
			case "auth/weak-password":
				errorMessage = "Password is too weak. Please use a stronger password.";
				break;
			default:
				errorMessage = error.message;
		}

		return { success: false, error: errorMessage };
	}
}

async function signOut() {
	try {
		if (auth) {
			await auth.signOut();
		}
		return { success: true };
	} catch (error) {
		console.error("Sign out error:", error);
		return { success: false, error: error.message };
	}
}

// ========== UI Updates ==========

function updateAuthUI() {
	const authButton = document.getElementById("authButton");
	const userAvatar = document.getElementById("userAvatar");
	const authButtonText = document.getElementById("authButtonText");

	if (!authButton) return;

	if (currentUser) {
		// Show user avatar and sign out option
		if (userAvatar) {
			userAvatar.src = currentUser.photoURL || "assets/logo-circle.svg";
			userAvatar.style.display = "block";
		}
		if (authButtonText) {
			authButtonText.textContent = "Sign Out";
		}
		authButton.onclick = handleSignOut;
		authButton.title = `Signed in as ${currentUser.displayName || currentUser.email}`;
	} else {
		// Show sign in button
		if (userAvatar) {
			userAvatar.style.display = "none";
		}
		if (authButtonText) {
			authButtonText.textContent = "Sign In";
		}
		authButton.onclick = handleSignIn;
		authButton.title = "Sign in";
	}

	// Also update settings drawer account section if it exists
	if (typeof updateSettingsAccountSection === "function") {
		updateSettingsAccountSection();
	}
}

function handleSignIn() {
	// Open the sign-in modal using MicroModal
	if (typeof MicroModal !== "undefined") {
		MicroModal.show("modal-signin");
	}
}

async function handleSignOut() {
	if (confirm("Are you sure you want to sign out?")) {
		const result = await signOut();
		if (!result.success) {
			alert("Sign out failed: " + result.error);
		}
	}
}

// ========== Sign-In Modal Functions ==========

let isSignUpMode = false;

function toggleSignupMode() {
	isSignUpMode = !isSignUpMode;
	const modalTitle = document.getElementById("modal-signin-title");
	const submitButton = document.getElementById("signin-submit-text");
	const toggleText = document.querySelector(".signin-toggle");

	if (isSignUpMode) {
		modalTitle.textContent = "Sign Up";
		submitButton.textContent = "Sign Up";
		toggleText.innerHTML = '<span>Already have an account? </span><button type="button" class="signin-toggle-btn" onclick="toggleSignupMode()">Sign in</button>';
	} else {
		modalTitle.textContent = "Sign In";
		submitButton.textContent = "Sign In";
		toggleText.innerHTML = '<span>Don\'t have an account? </span><button type="button" class="signin-toggle-btn" onclick="toggleSignupMode()">Sign up</button>';
	}

	// Clear form and errors when toggling
	document.getElementById("signin-form").reset();
	hideSignInError();
}

function showSignInError(message) {
	const errorDiv = document.getElementById("signin-error");
	if (errorDiv) {
		errorDiv.textContent = message;
		errorDiv.style.display = "block";
	}
}

function hideSignInError() {
	const errorDiv = document.getElementById("signin-error");
	if (errorDiv) {
		errorDiv.style.display = "none";
		errorDiv.textContent = "";
	}
}

function setSignInLoading(loading) {
	const submitButton = document.getElementById("signin-submit");
	const submitText = document.getElementById("signin-submit-text");
	const submitLoader = document.getElementById("signin-submit-loader");

	if (submitButton) {
		submitButton.disabled = loading;
	}
	if (submitText) {
		submitText.style.display = loading ? "none" : "inline";
	}
	if (submitLoader) {
		submitLoader.style.display = loading ? "inline" : "none";
	}
}

async function executeRecaptcha() {
	return new Promise((resolve) => {
		if (typeof grecaptcha !== "undefined") {
			grecaptcha.ready(() => {
				grecaptcha
					.execute("6LdVslAsAAAAAAwyU1wyjAxIG_K187E82ID2C7Re", { action: "submit" })
					.then((token) => {
						resolve(token);
					})
					.catch(() => {
						resolve(null);
					});
			});
		} else {
			// Fallback if grecaptcha is not loaded
			console.warn("reCAPTCHA not loaded");
			resolve(null);
		}
	});
}

async function handleSignInFormSubmit(event) {
	event.preventDefault();
	hideSignInError();
	setSignInLoading(true);

	const email = document.getElementById("signin-email").value;
	const password = document.getElementById("signin-password").value;

	try {
		// Execute reCAPTCHA
		const recaptchaToken = await executeRecaptcha();

		let result;
		if (isSignUpMode) {
			result = await signUpWithEmail(email, password, recaptchaToken);
		} else {
			result = await signInWithEmail(email, password, recaptchaToken);
		}

		if (result.success) {
			// Close modal on success
			if (typeof MicroModal !== "undefined") {
				MicroModal.close("modal-signin");
			}
			// Reset form and mode
			document.getElementById("signin-form").reset();
			if (isSignUpMode) {
				isSignUpMode = false;
				toggleSignupMode(); // Reset to sign-in mode
			}
		} else {
			showSignInError(result.error);
		}
	} catch (error) {
		showSignInError(error.message || "An unexpected error occurred");
	} finally {
		setSignInLoading(false);
	}
}

// Initialize sign-in form when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
	const signInForm = document.getElementById("signin-form");
	if (signInForm) {
		signInForm.addEventListener("submit", handleSignInFormSubmit);
	}

	// Initialize MicroModal
	if (typeof MicroModal !== "undefined") {
		MicroModal.init({
			disableScroll: true,
			awaitCloseAnimation: true,
		});
	}
});

// ========== Artifact Conversion ==========

// Convert a bookmark to artifact format
function bookmarkToArtifact(bookmark, userId) {
	const now = new Date().toISOString();

	// Find which project(s) this bookmark belongs to
	const projects = getProjects ? getProjects() : [];
	const projectIds = projects
		.filter((p) => p.paperIds && p.paperIds.includes(bookmark.id))
		.map((p) => p.id);

	return {
		id: generateULID(),
		type: "bookmark",
		title: bookmark.title || "Untitled Bookmark",

		owner: userId,

		acl: {
			owners: [userId],
			editors: [],
			viewers: [],
		},

		visibility: "private",

		primaryProjectId: projectIds.length > 0 ? projectIds[0] : null,
		projectIds: projectIds,

		tags: [],

		status: "active",
		schemaVersion: 1,

		createdAt: bookmark.createdAt
			? new Date(bookmark.createdAt).toISOString()
			: now,
		updatedAt: now,

		refs: {
			assets: [],
			sources: [],
			links: [],
		},

		data: {
			core: {
				text: bookmark.abstract || bookmark.aiAbstract || "",
				context: {
					source: bookmark.source || "",
					location: "",
					url: bookmark.doi
						? `https://doi.org/${bookmark.doi}`
						: bookmark.openAlexUrl || "",
				},
				assetIds: [],
				meta: {
					originalId: bookmark.id,
					authors: bookmark.authors || "",
					year: bookmark.year || "",
					publicationDate: bookmark.publication_date || "",
					doi: bookmark.doi || "",
					citedByCount: bookmark.cited_by_count || 0,
				},
			},

			researchLoader: {
				note: bookmark.note || "",
				aiSummary: bookmark.aiSummary || "",
				aiAbstract: bookmark.aiAbstract || "",
				aiAbstractGenerated: bookmark.aiAbstractGenerated || false,
				googleLinks: bookmark.googleLinks || [],
				googleLinksStatus: bookmark.googleLinksStatus || "",
			},
		},

		extraAttributes: {
			extraAttribute1: null,
			extraAttribute2: null,
			extraAttribute3: null,
			extraAttribute4: null,
			extraAttribute5: null,
		},
	};
}

// Convert a project to artifact format
function projectToArtifact(project, userId) {
	const now = new Date().toISOString();

	return {
		id: generateULID(),
		type: "project",
		title: project.name || "Untitled Project",

		owner: userId,

		acl: {
			owners: [userId],
			editors: [],
			viewers: [],
		},

		visibility: "private",

		primaryProjectId: null,
		projectIds: [],

		tags: [],

		status: "active",
		schemaVersion: 1,

		createdAt: project.createdAt
			? new Date(project.createdAt).toISOString()
			: now,
		updatedAt: now,

		refs: {
			assets: [],
			sources: [],
			links: [],
		},

		data: {
			core: {
				text: project.description || "",
				context: {
					source: "",
					location: "",
					url: "",
				},
				assetIds: [],
				meta: {
					originalId: project.id,
					paperIds: project.paperIds || [],
				},
			},

			researchLoader: {
				gptInstruction: project.gptInstruction || "",
			},
		},

		extraAttributes: {
			extraAttribute1: null,
			extraAttribute2: null,
			extraAttribute3: null,
			extraAttribute4: null,
			extraAttribute5: null,
		},
	};
}

// Convert an artifact back to bookmark format
function artifactToBookmark(artifact) {
	if (artifact.type !== "bookmark") {
		console.warn("Artifact is not a bookmark:", artifact.type);
		return null;
	}

	const core = artifact.data?.core || {};
	const researchLoader = artifact.data?.researchLoader || {};
	const meta = core.meta || {};

	return {
		id: meta.originalId || artifact.id,
		title: artifact.title,
		authors: meta.authors || "",
		year: meta.year || "",
		publication_date: meta.publicationDate || "",
		doi: meta.doi || "",
		cited_by_count: meta.citedByCount || 0,
		abstract: core.text || "",
		source: core.context?.source || "",
		openAlexUrl: core.context?.url || "",
		createdAt: artifact.createdAt
			? new Date(artifact.createdAt).getTime()
			: Date.now(),
		note: researchLoader.note || "",
		aiSummary: researchLoader.aiSummary || "",
		aiAbstract: researchLoader.aiAbstract || "",
		aiAbstractGenerated: researchLoader.aiAbstractGenerated || false,
		googleLinks: researchLoader.googleLinks || [],
		googleLinksStatus: researchLoader.googleLinksStatus || "",
	};
}

// Convert an artifact back to project format
function artifactToProject(artifact) {
	if (artifact.type !== "project") {
		console.warn("Artifact is not a project:", artifact.type);
		return null;
	}

	const core = artifact.data?.core || {};
	const researchLoader = artifact.data?.researchLoader || {};
	const meta = core.meta || {};

	return {
		id: meta.originalId || artifact.id,
		name: artifact.title,
		description: core.text || "",
		gptInstruction: researchLoader.gptInstruction || "",
		createdAt: artifact.createdAt
			? new Date(artifact.createdAt).getTime()
			: Date.now(),
		paperIds: meta.paperIds || [],
	};
}

// ========== Firestore Operations ==========

async function saveArtifactToFirestore(artifact) {
	if (!db || !currentUser) {
		console.error("Cannot save artifact: not authenticated");
		return { success: false, error: "Not authenticated" };
	}

	try {
		await db.collection(ARTIFICATES_COLLECTION).doc(artifact.id).set(artifact);
		return { success: true, id: artifact.id };
	} catch (error) {
		console.error("Error saving artifact:", error);
		return { success: false, error: error.message };
	}
}

async function getUserArtifacts(userId) {
	if (!db) {
		console.error("Firestore not initialized");
		return {
			success: false,
			artifacts: [],
			error: "Firestore not initialized",
		};
	}

	try {
		const snapshot = await db
			.collection(ARTIFICATES_COLLECTION)
			.where("owner", "==", userId)
			.get();

		const artifacts = [];
		snapshot.forEach((doc) => {
			artifacts.push(doc.data());
		});

		return { success: true, artifacts };
	} catch (error) {
		console.error("Error fetching artifacts:", error);
		return { success: false, artifacts: [], error: error.message };
	}
}

async function deleteArtifact(artifactId) {
	if (!db || !currentUser) {
		console.error("Cannot delete artifact: not authenticated");
		return { success: false, error: "Not authenticated" };
	}

	try {
		await db.collection(ARTIFICATES_COLLECTION).doc(artifactId).delete();
		return { success: true };
	} catch (error) {
		console.error("Error deleting artifact:", error);
		return { success: false, error: error.message };
	}
}

// ========== User Private (Encrypted) Operations ==========

// Save encrypted user settings (API tokens) to userPrivate collection
async function saveUserPrivateSettings(userId, settings) {
	if (!db || !userId) {
		console.error("Cannot save private settings: not authenticated");
		return { success: false, error: "Not authenticated" };
	}

	try {
		const key = await getEncryptionKey(userId);
		const encryptedData = await encryptData(settings, key);

		await db.collection(USER_PRIVATE_COLLECTION).doc(userId).set({
			encryptedSettings: encryptedData,
			updatedAt: new Date().toISOString(),
			schemaVersion: 1,
		});

		return { success: true };
	} catch (error) {
		console.error("Error saving private settings:", error);
		return { success: false, error: error.message };
	}
}

// Load and decrypt user settings from userPrivate collection
async function loadUserPrivateSettings(userId) {
	if (!db || !userId) {
		console.error("Cannot load private settings: not authenticated");
		return { success: false, settings: null, error: "Not authenticated" };
	}

	try {
		const doc = await db.collection(USER_PRIVATE_COLLECTION).doc(userId).get();

		if (!doc.exists) {
			return { success: true, settings: null }; // No settings saved yet
		}

		const data = doc.data();
		const key = await getEncryptionKey(userId);
		const decryptedSettings = await decryptData(data.encryptedSettings, key);

		return { success: true, settings: decryptedSettings };
	} catch (error) {
		console.error("Error loading private settings:", error);
		return { success: false, settings: null, error: error.message };
	}
}

// Sync API tokens to Firebase (encrypted)
async function syncApiTokensToFirebase(userId) {
	if (!userId) return { success: false, error: "No user ID" };

	try {
		// Gather all API tokens from local storage
		const settings = {
			google:
				typeof getGoogleSettings === "function" ? getGoogleSettings() : {},
			openai:
				typeof getOpenAISettings === "function" ? getOpenAISettings() : {},
		};

		// Only sync if there are actual tokens to save
		const hasTokens =
			(settings.google.apiKey && settings.google.apiKey.length > 0) ||
			(settings.openai.apiKey && settings.openai.apiKey.length > 0);

		if (!hasTokens) {
			return { success: true, message: "No tokens to sync" };
		}

		const result = await saveUserPrivateSettings(userId, settings);
		return result;
	} catch (error) {
		console.error("Error syncing API tokens:", error);
		return { success: false, error: error.message };
	}
}

// Load API tokens from Firebase and apply to local storage
async function loadApiTokensFromFirebase(userId) {
	if (!userId) return { success: false, error: "No user ID" };

	try {
		const result = await loadUserPrivateSettings(userId);

		if (!result.success || !result.settings) {
			return result;
		}

		const settings = result.settings;

		// Apply Google settings if present
		if (settings.google && typeof setGoogleSettings === "function") {
			setGoogleSettings(settings.google.apiKey || "", settings.google.cx || "");
		}

		// Apply OpenAI settings if present
		if (settings.openai && typeof setOpenAISettings === "function") {
			setOpenAISettings(settings.openai);
		}

		return { success: true };
	} catch (error) {
		console.error("Error loading API tokens:", error);
		return { success: false, error: error.message };
	}
}

// ========== Sync Operations ==========

async function checkAndSyncLocalData(user) {
	if (!user) return;

	const localBookmarks =
		typeof getBookmarks === "function" ? getBookmarks() : [];
	const localProjects = typeof getProjects === "function" ? getProjects() : [];

	const hasLocalData = localBookmarks.length > 0 || localProjects.length > 0;

	if (hasLocalData) {
		// Show sync notification
		const shouldSync = confirm(
			`Found ${localBookmarks.length} bookmark(s) and ${localProjects.length} project(s) stored locally.\n\n` +
				"Would you like to sync them to your account? This will merge with any existing data in your account.",
		);

		if (shouldSync) {
			await syncLocalDataToFirebase(user.uid);
		}
	}

	// Also sync any local API tokens to Firebase (encrypted)
	await syncApiTokensToFirebase(user.uid);

	// Load data from Firebase (including encrypted API tokens)
	await loadDataFromFirebase(user.uid);
	await loadApiTokensFromFirebase(user.uid);
}

async function syncLocalDataToFirebase(userId) {
	const syncStatus = document.getElementById("syncStatus");

	try {
		// Verify Firebase is initialized
		if (!db) {
			const errorMsg = "Firebase not initialized. Please refresh the page.";
			console.error(errorMsg);
			if (syncStatus) {
				syncStatus.textContent = errorMsg;
				syncStatus.style.display = "block";
			}
			return { success: false, error: errorMsg };
		}

		if (!currentUser) {
			const errorMsg = "Not authenticated. Please sign in again.";
			console.error(errorMsg);
			if (syncStatus) {
				syncStatus.textContent = errorMsg;
				syncStatus.style.display = "block";
			}
			return { success: false, error: errorMsg };
		}

		if (syncStatus) {
			syncStatus.textContent = "Syncing data...";
			syncStatus.style.display = "block";
		}

		console.log(
			`Starting sync for user ${userId}. Firebase initialized: ${!!db}, User authenticated: ${!!currentUser}`,
		);

		const localBookmarks =
			typeof getBookmarks === "function" ? getBookmarks() : [];
		const localProjects =
			typeof getProjects === "function" ? getProjects() : [];

		console.log(
			`Found ${localBookmarks.length} local bookmarks and ${localProjects.length} local projects to sync`,
		);

		// Get existing artifacts from Firebase
		const existingResult = await getUserArtifacts(userId);
		const existingArtifacts = existingResult.success
			? existingResult.artifacts
			: [];

		// Create a map of existing artifacts by original ID for merging
		const existingBookmarkIds = new Set();
		const existingProjectIds = new Set();

		existingArtifacts.forEach((artifact) => {
			const originalId = artifact.data?.core?.meta?.originalId;
			if (originalId) {
				if (artifact.type === "bookmark") {
					existingBookmarkIds.add(originalId);
				} else if (artifact.type === "project") {
					existingProjectIds.add(originalId);
				}
			}
		});

		// Sync bookmarks that don't already exist
		let syncedBookmarks = 0;
		const bookmarkErrors = [];
		for (const bookmark of localBookmarks) {
			if (!existingBookmarkIds.has(bookmark.id)) {
				const artifact = bookmarkToArtifact(bookmark, userId);
				const result = await saveArtifactToFirestore(artifact);
				if (result.success) {
					syncedBookmarks++;
				} else {
					bookmarkErrors.push({
						title: bookmark.title || "Untitled",
						error: result.error,
					});
					console.error(
						`Failed to sync bookmark "${bookmark.title}":`,
						result.error,
					);
				}
			}
		}

		// Sync projects that don't already exist
		let syncedProjects = 0;
		const projectErrors = [];
		for (const project of localProjects) {
			if (!existingProjectIds.has(project.id)) {
				const artifact = projectToArtifact(project, userId);
				const result = await saveArtifactToFirestore(artifact);
				if (result.success) {
					syncedProjects++;
				} else {
					projectErrors.push({
						name: project.name || "Untitled",
						error: result.error,
					});
					console.error(
						`Failed to sync project "${project.name}":`,
						result.error,
					);
				}
			}
		}

		// Also sync API tokens (encrypted)
		await syncApiTokensToFirebase(userId);

		// Note: We don't clear local data immediately anymore to keep it as backup
		// Local data will be overwritten when we load from Firebase

		if (syncStatus) {
			let statusMessage = `Synced ${syncedBookmarks} bookmark(s) and ${syncedProjects} project(s)`;

			// Add error information if any syncs failed
			if (bookmarkErrors.length > 0 || projectErrors.length > 0) {
				statusMessage += `\n\nFailed to sync: ${bookmarkErrors.length} bookmark(s) and ${projectErrors.length} project(s)`;
				if (bookmarkErrors.length > 0) {
					statusMessage += `\nBookmark errors: ${bookmarkErrors[0].error}`;
					if (bookmarkErrors.length > 1) {
						statusMessage += ` (and ${bookmarkErrors.length - 1} more)`;
					}
				}
				if (projectErrors.length > 0) {
					statusMessage += `\nProject errors: ${projectErrors[0].error}`;
					if (projectErrors.length > 1) {
						statusMessage += ` (and ${projectErrors.length - 1} more)`;
					}
				}
				statusMessage += `\n\nCheck the browser console for details.`;
			}

			syncStatus.textContent = statusMessage;
			setTimeout(() => {
				syncStatus.style.display = "none";
			}, bookmarkErrors.length > 0 || projectErrors.length > 0 ? 10000 : 3000);
		}

		console.log(
			`Synced ${syncedBookmarks} bookmarks and ${syncedProjects} projects`,
		);

		if (bookmarkErrors.length > 0 || projectErrors.length > 0) {
			console.warn(
				`Failed to sync ${bookmarkErrors.length} bookmarks and ${projectErrors.length} projects`,
			);
			console.warn("Bookmark errors:", bookmarkErrors);
			console.warn("Project errors:", projectErrors);
		}

		return {
			success: true,
			syncedBookmarks,
			syncedProjects,
			bookmarkErrors,
			projectErrors,
		};
	} catch (error) {
		console.error("Sync error:", error);
		if (syncStatus) {
			syncStatus.textContent = "Sync failed: " + error.message;
		}
		return { success: false, error: error.message };
	}
}

async function loadDataFromFirebase(userId) {
	try {
		const result = await getUserArtifacts(userId);

		if (!result.success) {
			console.error("Failed to load data from Firebase:", result.error);
			return;
		}

		const artifacts = result.artifacts;

		// Convert artifacts back to bookmarks and projects
		const bookmarks = [];
		const projects = [];

		artifacts.forEach((artifact) => {
			if (artifact.type === "bookmark") {
				const bookmark = artifactToBookmark(artifact);
				if (bookmark) {
					bookmarks.push(bookmark);
				}
			} else if (artifact.type === "project") {
				const project = artifactToProject(artifact);
				if (project) {
					projects.push(project);
				}
			}
		});

		// Update local storage with merged data
		if (typeof saveBookmarks === "function") {
			saveBookmarks(bookmarks);
		}
		if (typeof saveProjects === "function") {
			saveProjects(projects);
		}

		// Re-render the UI
		if (typeof renderCurrentView === "function") {
			renderCurrentView();
		}

		console.log(
			`Loaded ${bookmarks.length} bookmarks and ${projects.length} projects from Firebase`,
		);
	} catch (error) {
		console.error("Error loading data from Firebase:", error);
	}
}

function clearLocalData() {
	localStorage.removeItem("researchBookmarks");
	localStorage.removeItem("researchProjects");
	console.log("Local data cleared");
}

// ========== Real-time Sync ==========

let unsubscribeArtifacts = null;

function startRealtimeSync(userId) {
	if (!db || !userId) return;

	// Unsubscribe from previous listener if any
	if (unsubscribeArtifacts) {
		unsubscribeArtifacts();
	}

	// Listen for real-time updates
	unsubscribeArtifacts = db
		.collection(ARTIFICATES_COLLECTION)
		.where("owner", "==", userId)
		.onSnapshot(
			(snapshot) => {
				const bookmarks = [];
				const projects = [];

				snapshot.forEach((doc) => {
					const artifact = doc.data();
					if (artifact.type === "bookmark") {
						const bookmark = artifactToBookmark(artifact);
						if (bookmark) bookmarks.push(bookmark);
					} else if (artifact.type === "project") {
						const project = artifactToProject(artifact);
						if (project) projects.push(project);
					}
				});

				// Update local storage
				if (typeof saveBookmarks === "function") {
					saveBookmarks(bookmarks);
				}
				if (typeof saveProjects === "function") {
					saveProjects(projects);
				}

				// Re-render the UI
				if (typeof renderCurrentView === "function") {
					renderCurrentView();
				}
			},
			(error) => {
				console.error("Realtime sync error:", error);
			},
		);
}

function stopRealtimeSync() {
	if (unsubscribeArtifacts) {
		unsubscribeArtifacts();
		unsubscribeArtifacts = null;
	}
}

// ========== Export Functions ==========

// Make functions globally available
window.initializeFirebase = initializeFirebase;
window.signOut = signOut;
window.getCurrentUser = getCurrentUser;
window.isUserSignedIn = isUserSignedIn;
window.handleSignIn = handleSignIn;
window.handleSignOut = handleSignOut;
window.bookmarkToArtifact = bookmarkToArtifact;
window.projectToArtifact = projectToArtifact;
window.artifactToBookmark = artifactToBookmark;
window.artifactToProject = artifactToProject;
window.saveArtifactToFirestore = saveArtifactToFirestore;
window.getUserArtifacts = getUserArtifacts;
window.deleteArtifact = deleteArtifact;
window.syncLocalDataToFirebase = syncLocalDataToFirebase;
window.loadDataFromFirebase = loadDataFromFirebase;
window.startRealtimeSync = startRealtimeSync;
window.stopRealtimeSync = stopRealtimeSync;
window.generateULID = generateULID;
window.syncApiTokensToFirebase = syncApiTokensToFirebase;
window.loadApiTokensFromFirebase = loadApiTokensFromFirebase;
window.saveUserPrivateSettings = saveUserPrivateSettings;
window.loadUserPrivateSettings = loadUserPrivateSettings;

// Initialize Firebase when the script loads
document.addEventListener("DOMContentLoaded", initializeFirebase);
