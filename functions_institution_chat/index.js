const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const INSTITUTION_PROVINCE_ROOMS = Object.freeze([
  { provinceId: 'adana', provinceName: 'Adana', provinceCode: 1 },
  { provinceId: 'adiyaman', provinceName: 'Adıyaman', provinceCode: 2 },
  { provinceId: 'afyonkarahisar', provinceName: 'Afyonkarahisar', provinceCode: 3 },
  { provinceId: 'agri', provinceName: 'Ağrı', provinceCode: 4 },
  { provinceId: 'amasya', provinceName: 'Amasya', provinceCode: 5 },
  { provinceId: 'ankara', provinceName: 'Ankara', provinceCode: 6 },
  { provinceId: 'antalya', provinceName: 'Antalya', provinceCode: 7 },
  { provinceId: 'artvin', provinceName: 'Artvin', provinceCode: 8 },
  { provinceId: 'aydin', provinceName: 'Aydın', provinceCode: 9 },
  { provinceId: 'balikesir', provinceName: 'Balıkesir', provinceCode: 10 },
  { provinceId: 'bilecik', provinceName: 'Bilecik', provinceCode: 11 },
  { provinceId: 'bingol', provinceName: 'Bingöl', provinceCode: 12 },
  { provinceId: 'bitlis', provinceName: 'Bitlis', provinceCode: 13 },
  { provinceId: 'bolu', provinceName: 'Bolu', provinceCode: 14 },
  { provinceId: 'burdur', provinceName: 'Burdur', provinceCode: 15 },
  { provinceId: 'bursa', provinceName: 'Bursa', provinceCode: 16 },
  { provinceId: 'canakkale', provinceName: 'Çanakkale', provinceCode: 17 },
  { provinceId: 'cankiri', provinceName: 'Çankırı', provinceCode: 18 },
  { provinceId: 'corum', provinceName: 'Çorum', provinceCode: 19 },
  { provinceId: 'denizli', provinceName: 'Denizli', provinceCode: 20 },
  { provinceId: 'diyarbakir', provinceName: 'Diyarbakır', provinceCode: 21 },
  { provinceId: 'edirne', provinceName: 'Edirne', provinceCode: 22 },
  { provinceId: 'elazig', provinceName: 'Elazığ', provinceCode: 23 },
  { provinceId: 'erzincan', provinceName: 'Erzincan', provinceCode: 24 },
  { provinceId: 'erzurum', provinceName: 'Erzurum', provinceCode: 25 },
  { provinceId: 'eskisehir', provinceName: 'Eskişehir', provinceCode: 26 },
  { provinceId: 'gaziantep', provinceName: 'Gaziantep', provinceCode: 27 },
  { provinceId: 'giresun', provinceName: 'Giresun', provinceCode: 28 },
  { provinceId: 'gumushane', provinceName: 'Gümüşhane', provinceCode: 29 },
  { provinceId: 'hakkari', provinceName: 'Hakkari', provinceCode: 30 },
  { provinceId: 'hatay', provinceName: 'Hatay', provinceCode: 31 },
  { provinceId: 'isparta', provinceName: 'Isparta', provinceCode: 32 },
  { provinceId: 'mersin', provinceName: 'Mersin', provinceCode: 33 },
  { provinceId: 'istanbul', provinceName: 'İstanbul', provinceCode: 34 },
  { provinceId: 'izmir', provinceName: 'İzmir', provinceCode: 35 },
  { provinceId: 'kars', provinceName: 'Kars', provinceCode: 36 },
  { provinceId: 'kastamonu', provinceName: 'Kastamonu', provinceCode: 37 },
  { provinceId: 'kayseri', provinceName: 'Kayseri', provinceCode: 38 },
  { provinceId: 'kirklareli', provinceName: 'Kırklareli', provinceCode: 39 },
  { provinceId: 'kirsehir', provinceName: 'Kırşehir', provinceCode: 40 },
  { provinceId: 'kocaeli', provinceName: 'Kocaeli', provinceCode: 41 },
  { provinceId: 'konya', provinceName: 'Konya', provinceCode: 42 },
  { provinceId: 'kutahya', provinceName: 'Kütahya', provinceCode: 43 },
  { provinceId: 'malatya', provinceName: 'Malatya', provinceCode: 44 },
  { provinceId: 'manisa', provinceName: 'Manisa', provinceCode: 45 },
  { provinceId: 'kahramanmaras', provinceName: 'Kahramanmaraş', provinceCode: 46 },
  { provinceId: 'mardin', provinceName: 'Mardin', provinceCode: 47 },
  { provinceId: 'mugla', provinceName: 'Muğla', provinceCode: 48 },
  { provinceId: 'mus', provinceName: 'Muş', provinceCode: 49 },
  { provinceId: 'nevsehir', provinceName: 'Nevşehir', provinceCode: 50 },
  { provinceId: 'nigde', provinceName: 'Niğde', provinceCode: 51 },
  { provinceId: 'ordu', provinceName: 'Ordu', provinceCode: 52 },
  { provinceId: 'rize', provinceName: 'Rize', provinceCode: 53 },
  { provinceId: 'sakarya', provinceName: 'Sakarya', provinceCode: 54 },
  { provinceId: 'samsun', provinceName: 'Samsun', provinceCode: 55 },
  { provinceId: 'siirt', provinceName: 'Siirt', provinceCode: 56 },
  { provinceId: 'sinop', provinceName: 'Sinop', provinceCode: 57 },
  { provinceId: 'sivas', provinceName: 'Sivas', provinceCode: 58 },
  { provinceId: 'tekirdag', provinceName: 'Tekirdağ', provinceCode: 59 },
  { provinceId: 'tokat', provinceName: 'Tokat', provinceCode: 60 },
  { provinceId: 'trabzon', provinceName: 'Trabzon', provinceCode: 61 },
  { provinceId: 'tunceli', provinceName: 'Tunceli', provinceCode: 62 },
  { provinceId: 'sanliurfa', provinceName: 'Şanlıurfa', provinceCode: 63 },
  { provinceId: 'usak', provinceName: 'Uşak', provinceCode: 64 },
  { provinceId: 'van', provinceName: 'Van', provinceCode: 65 },
  { provinceId: 'yozgat', provinceName: 'Yozgat', provinceCode: 66 },
  { provinceId: 'zonguldak', provinceName: 'Zonguldak', provinceCode: 67 },
  { provinceId: 'aksaray', provinceName: 'Aksaray', provinceCode: 68 },
  { provinceId: 'bayburt', provinceName: 'Bayburt', provinceCode: 69 },
  { provinceId: 'karaman', provinceName: 'Karaman', provinceCode: 70 },
  { provinceId: 'kirikkale', provinceName: 'Kırıkkale', provinceCode: 71 },
  { provinceId: 'batman', provinceName: 'Batman', provinceCode: 72 },
  { provinceId: 'sirnak', provinceName: 'Şırnak', provinceCode: 73 },
  { provinceId: 'bartin', provinceName: 'Bartın', provinceCode: 74 },
  { provinceId: 'ardahan', provinceName: 'Ardahan', provinceCode: 75 },
  { provinceId: 'igdir', provinceName: 'Iğdır', provinceCode: 76 },
  { provinceId: 'yalova', provinceName: 'Yalova', provinceCode: 77 },
  { provinceId: 'karabuk', provinceName: 'Karabük', provinceCode: 78 },
  { provinceId: 'kilis', provinceName: 'Kilis', provinceCode: 79 },
  { provinceId: 'osmaniye', provinceName: 'Osmaniye', provinceCode: 80 },
  { provinceId: 'duzce', provinceName: 'Düzce', provinceCode: 81 },
]);

const INSTITUTION_PROVINCE_MAP = Object.freeze(
  INSTITUTION_PROVINCE_ROOMS.reduce((acc, item) => {
    acc[item.provinceId] = item;
    return acc;
  }, {})
);

const INSTITUTION_GENERAL_ROOM = Object.freeze({
  provinceId: 'genel',
  provinceName: 'Genel İletişim Odası (Tüm Türkiye)',
  provinceCode: 'TR',
  roomType: 'national',
});

function isAllowedInstitutionRoomId(roomId) {
  const id = String(roomId || '').trim().toLowerCase();
  return !!(id && (INSTITUTION_PROVINCE_MAP[id] || id === INSTITUTION_GENERAL_ROOM.provinceId));
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSenderAdminName(userData, uid) {
  const d = userData || {};
  return String(
    d.displayName
      || d.name
      || d.fullName
      || d.username
      || d.email
      || uid
  ).trim();
}

const INSTITUTION_CHAT_REPLY_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const INSTITUTION_CHAT_REPLY_MESSAGE_ID_MAX_LEN = 128;
const INSTITUTION_CHAT_REPLY_PREVIEW_MAX_LEN = 160;

function normalizeInstitutionChatReplyPreview(value, maxLength) {
  const limit = (typeof maxLength === 'number' && maxLength > 0)
    ? maxLength
    : INSTITUTION_CHAT_REPLY_PREVIEW_MAX_LEN;
  const raw = (typeof value === 'string') ? value : '';
  const normalized = raw.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  const truncated = normalized.slice(0, limit - 1).replace(/\s+$/, '');
  return truncated + '…';
}

function parseOptionalInstitutionChatReplyToMessageId(data) {
  if (!data || data.replyToMessageId == null || data.replyToMessageId === undefined) {
    return null;
  }
  if (typeof data.replyToMessageId !== 'string') {
    throw new HttpsError('invalid-argument', 'Geçersiz yanıt mesajı kimliği.');
  }
  const trimmed = data.replyToMessageId.trim();
  if (!trimmed || trimmed.length > INSTITUTION_CHAT_REPLY_MESSAGE_ID_MAX_LEN) {
    throw new HttpsError('invalid-argument', 'Geçersiz yanıt mesajı kimliği.');
  }
  if (!INSTITUTION_CHAT_REPLY_MESSAGE_ID_PATTERN.test(trimmed)) {
    throw new HttpsError('invalid-argument', 'Geçersiz yanıt mesajı kimliği.');
  }
  return trimmed;
}

async function resolveInstitutionChatReplyMetadata(roomRef, replyToMessageId) {
  const sourceSnap = await roomRef.collection('messages').doc(replyToMessageId).get();
  if (!sourceSnap.exists) {
    throw new HttpsError('not-found', 'Yanıtlanmak istenen mesaj bulunamadı.');
  }
  const source = sourceSnap.data() || {};
  if (source.isDeleted === true || source.isHidden === true) {
    throw new HttpsError('failed-precondition', 'Yanıtlanmak istenen mesaj artık kullanılamıyor.');
  }
  const sourceText = (typeof source.text === 'string') ? source.text : '';
  return {
    replyToMessageId,
    replyToSenderName: String(source.senderAdminName || '').trim() || 'Yönetici',
    replyToTenantName: String(source.senderTenantName || '').trim(),
    replyToTextPreview: normalizeInstitutionChatReplyPreview(
      sourceText,
      INSTITUTION_CHAT_REPLY_PREVIEW_MAX_LEN
    ),
  };
}

async function getCallerUserOrThrow(uid) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'Caller user record not found.');
  }
  return snap.data() || {};
}

async function getActiveInstitutionAdminMemberships(uid) {
  const memSnap = await db.collection('tenantMemberships')
    .where('uid', '==', uid)
    .where('role', '==', 'institution_admin')
    .where('status', '==', 'active')
    .get();
  return (memSnap.docs || []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

exports.seedInstitutionProvinceRooms = onCall(async (request) => {
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  try {
    const callerUser = await getCallerUserOrThrow(callerUid);
    const callerRole = normalizeRole(callerUser.role);
    if (callerRole !== 'super_admin') {
      throw new HttpsError('permission-denied', 'Only super_admin can seed province rooms.');
    }

    const roomsToSeed = INSTITUTION_PROVINCE_ROOMS.concat([INSTITUTION_GENERAL_ROOM]);
    const roomRefs = roomsToSeed.map((room) => db.collection('institutionProvinceRooms').doc(room.provinceId));
    const existingSnaps = await db.getAll(...roomRefs);
    const existingMap = {};
    existingSnaps.forEach((snap) => {
      existingMap[snap.id] = snap.exists ? (snap.data() || {}) : null;
    });

    const batch = db.batch();
    roomsToSeed.forEach((room) => {
      const existing = existingMap[room.provinceId];
      const payload = {
        provinceId: room.provinceId,
        provinceName: room.provinceName,
        provinceCode: room.provinceCode,
        isActive: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (room.roomType) payload.roomType = room.roomType;
      if (!existing || !existing.createdAt) payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
      if (!existing || typeof existing.lastMessageAt === 'undefined') payload.lastMessageAt = null;
      if (!existing || typeof existing.lastMessagePreview !== 'string') payload.lastMessagePreview = '';
      if (!existing || typeof existing.messageCount !== 'number') payload.messageCount = 0;
      batch.set(db.collection('institutionProvinceRooms').doc(room.provinceId), payload, { merge: true });
    });

    await batch.commit();
    return { ok: true, seeded: roomsToSeed.length };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', (e && e.message) ? e.message : 'Failed to seed province rooms.');
  }
});

exports.createInstitutionProvinceMessage = onCall(async (request) => {
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const data = request && request.data ? request.data : {};
  const provinceId = (data && data.provinceId ? String(data.provinceId) : '').trim().toLowerCase();
  const textRaw = (data && typeof data.text === 'string') ? data.text : null;
  if (!provinceId || !isAllowedInstitutionRoomId(provinceId)) {
    throw new HttpsError('invalid-argument', 'provinceId is required and must be a known province.');
  }
  if (typeof textRaw !== 'string') {
    throw new HttpsError('invalid-argument', 'text must be a string.');
  }
  const text = textRaw.trim();
  if (!text) {
    throw new HttpsError('invalid-argument', 'text cannot be empty.');
  }
  if (text.length > 1500) {
    throw new HttpsError('invalid-argument', 'text must be 1500 characters or less.');
  }

  try {
    const callerUser = await getCallerUserOrThrow(callerUid);
    const callerRole = normalizeRole(callerUser.role);

    let senderRole = null;
    let senderTenantId = null;
    let senderTenantName = '';

    if (callerRole === 'super_admin') {
      senderRole = 'super_admin';
      senderTenantId = null;
      senderTenantName = 'Sürücü Akademisi';
    } else if (callerRole === 'institution_admin') {
      const memberships = await getActiveInstitutionAdminMemberships(callerUid);
      if (!memberships.length) {
        throw new HttpsError('permission-denied', 'Active institution_admin membership is required.');
      }
      memberships.sort((a, b) => String(a.tenantId || '').localeCompare(String(b.tenantId || '')));
      const selectedMembership = memberships[0];
      const tenantId = String(selectedMembership.tenantId || '').trim();
      if (!tenantId) {
        throw new HttpsError('failed-precondition', 'Active institution_admin membership tenantId missing.');
      }
      const tenantSnap = await db.collection('tenants').doc(tenantId).get();
      senderRole = 'institution_admin';
      senderTenantId = tenantId;
      senderTenantName = (tenantSnap.exists && tenantSnap.data() && tenantSnap.data().name)
        ? String(tenantSnap.data().name).trim()
        : tenantId;
    } else {
      throw new HttpsError('permission-denied', 'Only super_admin or institution_admin can send messages.');
    }

    const roomRef = db.collection('institutionProvinceRooms').doc(provinceId);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) {
      throw new HttpsError('not-found', 'Province room not found.');
    }
    const roomData = roomSnap.data() || {};
    if (roomData.isActive === false) {
      throw new HttpsError('failed-precondition', 'Province room is inactive.');
    }

    const replyToMessageId = parseOptionalInstitutionChatReplyToMessageId(data);
    let replyMetadata = {};
    if (replyToMessageId) {
      replyMetadata = await resolveInstitutionChatReplyMetadata(roomRef, replyToMessageId);
    }

    const senderAdminName = normalizeSenderAdminName(callerUser, callerUid);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const messageRef = roomRef.collection('messages').doc();
    await messageRef.set({
      roomId: provinceId,
      provinceId: provinceId,
      text,
      senderUid: callerUid,
      senderRole,
      senderTenantId,
      senderTenantName,
      senderAdminName,
      createdAt: now,
      updatedAt: now,
      isHidden: false,
      hiddenAt: null,
      hiddenBy: null,
      hiddenReason: '',
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      deletedReason: '',
      ...replyMetadata,
    });

    const preview = text.length > 180 ? text.slice(0, 180) : text;
    await roomRef.set({
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessagePreview: preview,
      messageCount: admin.firestore.FieldValue.increment(1),
    }, { merge: true });

    return { ok: true, messageId: messageRef.id };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', (e && e.message) ? e.message : 'Failed to create province message.');
  }
});

exports.hideInstitutionProvinceMessage = onCall(async (request) => {
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const data = request && request.data ? request.data : {};
  const provinceId = (data && data.provinceId ? String(data.provinceId) : '').trim().toLowerCase();
  const messageId = (data && data.messageId ? String(data.messageId) : '').trim();
  const reason = (data && data.reason != null ? String(data.reason) : '').trim();

  if (!provinceId || !isAllowedInstitutionRoomId(provinceId)) {
    throw new HttpsError('invalid-argument', 'provinceId is required and must be a known province.');
  }
  if (!messageId) {
    throw new HttpsError('invalid-argument', 'messageId is required.');
  }
  if (reason.length > 300) {
    throw new HttpsError('invalid-argument', 'reason must be 300 characters or less.');
  }

  try {
    const callerUser = await getCallerUserOrThrow(callerUid);
    const callerRole = normalizeRole(callerUser.role);
    if (callerRole !== 'super_admin') {
      throw new HttpsError('permission-denied', 'Only super_admin can hide messages.');
    }

    const msgRef = db.collection('institutionProvinceRooms').doc(provinceId).collection('messages').doc(messageId);
    const msgSnap = await msgRef.get();
    if (!msgSnap.exists) {
      throw new HttpsError('not-found', 'Message not found.');
    }

    await msgRef.set({
      isHidden: true,
      hiddenAt: admin.firestore.FieldValue.serverTimestamp(),
      hiddenBy: callerUid,
      hiddenReason: reason,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { ok: true };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', (e && e.message) ? e.message : 'Failed to hide message.');
  }
});

exports.updateInstitutionProvinceMessage = onCall(async (request) => {
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const data = request && request.data ? request.data : {};
  const provinceId = (data && data.provinceId ? String(data.provinceId) : '').trim().toLowerCase();
  const messageId = (data && data.messageId ? String(data.messageId) : '').trim();
  const textRaw = (data && typeof data.text === 'string') ? data.text : null;

  if (!provinceId || !isAllowedInstitutionRoomId(provinceId)) {
    throw new HttpsError('invalid-argument', 'provinceId is required and must be a known province.');
  }
  if (!messageId) {
    throw new HttpsError('invalid-argument', 'messageId is required.');
  }
  if (typeof textRaw !== 'string') {
    throw new HttpsError('invalid-argument', 'text must be a string.');
  }
  const text = textRaw.trim();
  if (!text) {
    throw new HttpsError('invalid-argument', 'text cannot be empty.');
  }
  if (text.length > 1500) {
    throw new HttpsError('invalid-argument', 'text must be 1500 characters or less.');
  }

  try {
    await getCallerUserOrThrow(callerUid);

    const msgRef = db.collection('institutionProvinceRooms').doc(provinceId).collection('messages').doc(messageId);
    const msgSnap = await msgRef.get();
    if (!msgSnap.exists) {
      throw new HttpsError('not-found', 'Message not found.');
    }

    const msgData = msgSnap.data() || {};
    if (msgData.isHidden === true) {
      throw new HttpsError('failed-precondition', 'Hidden messages cannot be edited.');
    }
    if (msgData.isDeleted === true) {
      throw new HttpsError('failed-precondition', 'Deleted messages cannot be edited.');
    }
    if (String(msgData.senderUid || '').trim() !== callerUid) {
      throw new HttpsError('permission-denied', 'Only the message owner can edit this message.');
    }

    await msgRef.set({
      text,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      editedAt: admin.firestore.FieldValue.serverTimestamp(),
      editedBy: callerUid,
    }, { merge: true });

    return { ok: true };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', (e && e.message) ? e.message : 'Failed to update message.');
  }
});

exports.deleteInstitutionProvinceMessage = onCall(async (request) => {
  const callerUid = request && request.auth ? request.auth.uid : null;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const data = request && request.data ? request.data : {};
  const provinceId = (data && data.provinceId ? String(data.provinceId) : '').trim().toLowerCase();
  const messageId = (data && data.messageId ? String(data.messageId) : '').trim();

  if (!provinceId || !isAllowedInstitutionRoomId(provinceId)) {
    throw new HttpsError('invalid-argument', 'provinceId is required and must be a known province.');
  }
  if (!messageId) {
    throw new HttpsError('invalid-argument', 'messageId is required.');
  }

  try {
    await getCallerUserOrThrow(callerUid);

    const msgRef = db.collection('institutionProvinceRooms').doc(provinceId).collection('messages').doc(messageId);
    const msgSnap = await msgRef.get();
    if (!msgSnap.exists) {
      throw new HttpsError('not-found', 'Message not found.');
    }

    const msgData = msgSnap.data() || {};
    if (String(msgData.senderUid || '').trim() !== callerUid) {
      throw new HttpsError('permission-denied', 'Only the message owner can delete this message.');
    }
    if (msgData.isDeleted === true) {
      return { ok: true, alreadyDeleted: true };
    }

    await msgRef.set({
      isDeleted: true,
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      deletedBy: callerUid,
      deletedReason: 'user_deleted',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      text: '[Mesaj silindi]',
    }, { merge: true });

    return { ok: true };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', (e && e.message) ? e.message : 'Failed to delete message.');
  }
});
