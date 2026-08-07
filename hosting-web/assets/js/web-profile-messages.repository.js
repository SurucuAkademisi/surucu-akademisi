/**
 * Profilim — institution student mailbox messages (read + student reply/write).
 * Path: tenantMailbox/{tenantId}/messages
 */
(function () {
  'use strict';

  var LOG_PREFIX = '[web-profile-messages]';
  var FETCH_LIMIT = 50;

  function getDb() {
    var fb = window.SA_WEB_FIREBASE;
    if (fb && fb.ready && fb.db) return fb.db;
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
      return window.firebase.firestore();
    }
    return null;
  }

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function createdAtMillis(createdAt) {
    if (!createdAt) return 0;
    if (typeof createdAt.toMillis === 'function') {
      return createdAt.toMillis();
    }
    if (createdAt instanceof Date) {
      return createdAt.getTime();
    }
    if (typeof createdAt === 'number' && isFinite(createdAt)) {
      return createdAt;
    }
    if (typeof createdAt === 'string') {
      var parsed = Date.parse(createdAt);
      return isFinite(parsed) ? parsed : 0;
    }
    if (typeof createdAt.seconds === 'number') {
      return createdAt.seconds * 1000;
    }
    return 0;
  }

  var PLATFORM_SENDER_LABEL = 'Sürücü Akademisi';
  var GENERIC_INSTITUTION_ADMIN_LABEL = 'Kurum Admini';

  function isGenericInstitutionAdminSenderName(name) {
    var n = normalizeString(name);
    if (!n) return true;
    if (n.indexOf('@') !== -1) return true;
    var lower = n.toLowerCase();
    if (lower === PLATFORM_SENDER_LABEL.toLowerCase()) return true;
    if (lower === 'surucu akademisi') return true;
    if (lower === GENERIC_INSTITUTION_ADMIN_LABEL.toLowerCase()) return true;
    return false;
  }

  function resolveInstitutionAdminSenderDisplay(senderName, tenantDisplayName, tenantId) {
    if (!isGenericInstitutionAdminSenderName(senderName)) return normalizeString(senderName);
    var tenantName = normalizeString(tenantDisplayName);
    if (tenantName) return tenantName;
    var tid = normalizeString(tenantId);
    if (tid) return tid;
    return 'Kurum';
  }

  function resolveSenderName(data, tenantDisplayName) {
    var raw = data || {};
    var ch = normalizeString(raw.messageChannel);
    var senderType = normalizeString(raw.senderType).toLowerCase();
    var name = normalizeString(raw.senderName);
    var tenantName = normalizeString(tenantDisplayName);
    var tenantId = normalizeString(raw.tenantId);

    if (ch === 'tenant_to_student') {
      return resolveInstitutionAdminSenderDisplay(name, tenantName, tenantId);
    }
    if (ch === 'platform_to_student') {
      return PLATFORM_SENDER_LABEL;
    }

    if (senderType === 'super_admin') return PLATFORM_SENDER_LABEL;

    if (senderType === 'student') {
      if (name) return name;
      var email = normalizeString(raw.senderEmail);
      if (email) return email;
      return 'Öğrenci';
    }

    if (senderType === 'institution_admin') {
      return resolveInstitutionAdminSenderDisplay(name, tenantName, tenantId);
    }

    if (name) return name;
    return 'Gönderen';
  }

  function resolveReplyTarget(originalMessage) {
    var m = originalMessage || {};
    var replyTarget = normalizeString(m.replyTargetType).toLowerCase();
    if (replyTarget === 'super_admin') return 'super_admin';
    if (replyTarget === 'tenant') return 'tenant';

    var ch = normalizeString(m.messageChannel).toLowerCase();
    if (ch === 'platform_to_student' || ch === 'platform_to_public_user') return 'super_admin';

    var senderType = normalizeString(m.senderType).toLowerCase();
    if (senderType === 'super_admin') return 'super_admin';
    if (ch === 'tenant_to_student') return 'tenant';
    if (senderType === 'institution_admin') return 'tenant';
    return 'tenant';
  }

  function isMessageReplyable(originalMessage) {
    var m = originalMessage || {};
    var ch = normalizeString(m.messageChannel).toLowerCase();
    if (ch === 'platform_to_student' || ch === 'platform_to_public_user' || ch === 'tenant_to_student') {
      return true;
    }
    var senderType = normalizeString(m.senderType).toLowerCase();
    if (senderType === 'super_admin' || senderType === 'institution_admin') return true;
    return false;
  }

  function saReplyTargetSuperAdmin() {
    return {
      replyTargetType: 'super_admin',
      replyTargetInbox: 'platformMailbox',
      replyTargetTenantId: null
    };
  }

  function normalizeMessageDoc(id, data, uid, tenantDisplayName) {
    var raw = data || {};
    var recipientType = normalizeString(raw.recipientType).toLowerCase();
    var recipientId = normalizeString(raw.recipientId);
    var senderUid = normalizeString(raw.senderUid);
    var isIncoming = recipientType === 'student' && recipientId === uid;
    var isSentOwn = senderUid === uid;
    if (!isIncoming && !isSentOwn) {
      return null;
    }

    var body = normalizeString(raw.body);
    var subject = normalizeString(raw.subject) || '(Konu yok)';

    var deletedForStudent = raw.deletedForStudent === true;

    return {
      id: normalizeString(id),
      subject: subject,
      body: body,
      senderName: resolveSenderName(raw, tenantDisplayName),
      senderType: normalizeString(raw.senderType).toLowerCase(),
      senderUid: senderUid,
      messageChannel: normalizeString(raw.messageChannel),
      replyTargetType: normalizeString(raw.replyTargetType),
      tenantId: normalizeString(raw.tenantId),
      recipientType: recipientType,
      recipientId: recipientId,
      inReplyTo: normalizeString(raw.inReplyTo),
      originalSubject: normalizeString(raw.originalSubject),
      threadId: normalizeString(raw.threadId),
      rootMessageId: normalizeString(raw.rootMessageId),
      parentMessageId: normalizeString(raw.parentMessageId),
      createdAt: raw.createdAt || null,
      createdAtMs: createdAtMillis(raw.createdAt),
      isUnread: deletedForStudent ? false : (isIncoming ? raw.isReadByStudent !== true : false),
      replyable: deletedForStudent ? false : (isIncoming ? isMessageReplyable(raw) : false),
      direction: isIncoming ? 'incoming' : 'sent',
      deletedForStudent: deletedForStudent
    };
  }

  function isOwnStudentMailboxDoc(raw, uid) {
    var data = raw || {};
    var recipientType = normalizeString(data.recipientType).toLowerCase();
    var recipientId = normalizeString(data.recipientId);
    var senderUid = normalizeString(data.senderUid);
    if (recipientType === 'student' && recipientId === uid) return true;
    if (senderUid === uid) return true;
    return false;
  }

  function deriveStudentReplyThreadFields(parentId, parentData) {
    var parent = parentData || {};
    var parentMessageId = normalizeString(parentId);
    var threadId = normalizeString(parent.threadId);
    var rootMessageId = normalizeString(parent.rootMessageId);
    if (!rootMessageId && threadId) rootMessageId = threadId;
    if (!threadId && rootMessageId) threadId = rootMessageId;
    if (!rootMessageId) {
      var parentInReplyTo = normalizeString(parent.inReplyTo);
      rootMessageId = parentInReplyTo || parentMessageId;
    }
    if (!threadId) threadId = rootMessageId;
    return {
      parentMessageId: parentMessageId,
      inReplyTo: parentMessageId,
      threadId: threadId,
      rootMessageId: rootMessageId
    };
  }

  function cleanWebMailboxDisplaySubject(subject) {
    var s = normalizeString(subject) || '(Konu yok)';
    var guard = 0;
    while (guard < 8 && /^(re:|yanıt:|yanit:)\s*/i.test(s)) {
      s = s.replace(/^(re:|yanıt:|yanit:)\s*/i, '').trim();
      guard++;
    }
    return s || '(Konu yok)';
  }

  function isStudentConversationChannel(ch) {
    var c = normalizeString(ch);
    return c === 'tenant_to_student' || c === 'student_to_tenant';
  }

  function isStudentConversationRaw(d) {
    if (!d) return false;
    var ch = normalizeString(d.messageChannel);
    if (isStudentConversationChannel(ch)) return true;
    var st = normalizeString(d.senderType).toLowerCase();
    var rt = normalizeString(d.recipientType).toLowerCase();
    if (st === 'student' && rt === 'tenant') return true;
    if (st === 'institution_admin' && rt === 'student') return true;
    return false;
  }

  function isBulkStudentMessage(d) {
    return !!(d && d.isBulk === true && normalizeString(d.bulkBatchId));
  }

  function deriveWebMailboxThreadId(msg, docMap) {
    var map = docMap || {};
    var m = msg || {};
    var msgId = normalizeString(m.id);
    var existingThread = normalizeString(m.threadId);
    if (existingThread) return existingThread;
    var existingRoot = normalizeString(m.rootMessageId);
    if (existingRoot) return existingRoot;

    var visited = {};
    var parentId = normalizeString(m.parentMessageId || m.inReplyTo);
    var lastAncestorId = '';
    var chainBroken = false;
    while (parentId) {
      if (visited[parentId]) break;
      visited[parentId] = true;
      lastAncestorId = parentId;
      var parent = map[parentId];
      if (!parent) {
        chainBroken = true;
        break;
      }
      var pThread = normalizeString(parent.threadId);
      if (pThread) return pThread;
      var pRoot = normalizeString(parent.rootMessageId);
      if (pRoot) return pRoot;
      parentId = normalizeString(parent.parentMessageId || parent.inReplyTo);
    }

    var inReplyTo = normalizeString(m.inReplyTo);
    var ch = normalizeString(m.messageChannel);
    var st = normalizeString(m.senderType).toLowerCase();
    var isStudentReply = ch === 'student_to_tenant' || st === 'student' || st === 'public_user';
    if (chainBroken) {
      if (inReplyTo && isStudentReply) return inReplyTo;
      return msgId || inReplyTo || lastAncestorId;
    }
    if (lastAncestorId) return lastAncestorId;
    if (inReplyTo && isStudentReply) return inReplyTo;
    return msgId || inReplyTo;
  }

  function resolveThreadRootSubject(messages, threadId, docMap) {
    var map = docMap || {};
    var rootRaw = map[threadId];
    if (rootRaw) {
      return cleanWebMailboxDisplaySubject(rootRaw.originalSubject || rootRaw.subject || '');
    }
    var best = '';
    var earliestMs = Infinity;
    (messages || []).forEach(function (item) {
      var raw = (item && item.raw) || {};
      var ms = item.ms != null ? item.ms : createdAtMillis(raw.createdAt);
      var candidate = normalizeString(raw.originalSubject || raw.subject);
      if (!candidate) return;
      if (ms < earliestMs) {
        earliestMs = ms;
        best = candidate;
      }
    });
    return cleanWebMailboxDisplaySubject(best);
  }

  function buildConversationThreadsFromDocs(docsById, options) {
    options = options || {};
    var map = docsById || {};
    var mode = options.mode === 'public' ? 'public' : 'institution';
    var tenantDisplayName = normalizeString(options.tenantDisplayName);
    var uid = normalizeString(options.uid);
    var groups = {};

    Object.keys(map).forEach(function (id) {
      var raw = map[id] || {};
      if (mode === 'institution') {
        if (!isStudentConversationRaw(raw)) return;
        if (isBulkStudentMessage(raw)) return;
      }
      var msgWithId = Object.assign({ id: id }, raw);
      var threadId = deriveWebMailboxThreadId(msgWithId, map);
      if (!threadId) threadId = id;
      if (!groups[threadId]) groups[threadId] = { threadId: threadId, messages: [] };
      groups[threadId].messages.push({
        id: id,
        raw: raw,
        ms: createdAtMillis(raw.createdAt)
      });
    });

    var threads = Object.keys(groups).map(function (tid) {
      var g = groups[tid];
      g.messages.sort(function (a, b) { return (a.ms || 0) - (b.ms || 0); });
      var latest = g.messages[g.messages.length - 1] || { raw: {}, ms: 0, id: '' };
      var unreadCount = 0;
      g.messages.forEach(function (item) {
        var raw = item.raw || {};
        if (mode === 'public') {
          if (raw.deletedForPublicUser === true) return;
          var isIncomingPublic = false;
          var pch = normalizeString(raw.messageChannel);
          var pst = normalizeString(raw.senderType).toLowerCase();
          if (pch === 'platform_to_public_user' || pst === 'super_admin' || pst === 'platform') isIncomingPublic = true;
          if (pch === 'public_to_platform' || pst === 'public_user') isIncomingPublic = false;
          if (isIncomingPublic && raw.isRead !== true) unreadCount++;
        } else {
          if (raw.deletedForStudent === true) return;
          var ch = normalizeString(raw.messageChannel);
          var st = normalizeString(raw.senderType).toLowerCase();
          var rt = normalizeString(raw.recipientType).toLowerCase();
          var rid = normalizeString(raw.recipientId);
          var isIncomingTenant = (
            ch === 'tenant_to_student'
            || ch === 'platform_to_student'
            || ((st === 'institution_admin' || st === 'super_admin') && rt === 'student')
          ) && rid === uid;
          if (isIncomingTenant && raw.isReadByStudent !== true) unreadCount++;
        }
      });
      var rootSubject = resolveThreadRootSubject(g.messages, tid, map);
      var rootMessageId = tid;
      if (map[tid] && normalizeString(map[tid].rootMessageId)) {
        rootMessageId = normalizeString(map[tid].rootMessageId);
      } else {
        for (var i = 0; i < g.messages.length; i++) {
          var cand = normalizeString((g.messages[i].raw || {}).rootMessageId || (g.messages[i].raw || {}).threadId);
          if (cand) { rootMessageId = cand; break; }
        }
      }
      var schoolOrSender = mode === 'public'
        ? PLATFORM_SENDER_LABEL
        : (tenantDisplayName || 'Kurum');
      if (mode === 'public' && latest.raw) {
        var sn = normalizeString(latest.raw.senderName);
        var sst = normalizeString(latest.raw.senderType).toLowerCase();
        if (sn && sst !== 'public_user') schoolOrSender = sn;
        else if (sst === 'super_admin' || normalizeString(latest.raw.messageChannel) === 'platform_to_public_user') {
          schoolOrSender = PLATFORM_SENDER_LABEL;
        }
      }
      var normalizedMessages = g.messages.map(function (item) {
        if (mode === 'public') {
          return normalizePublicMessageDoc(item.id, item.raw);
        }
        return normalizeMessageDoc(item.id, item.raw, uid, tenantDisplayName);
      }).filter(Boolean);

      return {
        threadId: tid,
        rootMessageId: rootMessageId || tid,
        subject: rootSubject,
        participantLabel: schoolOrSender,
        messages: normalizedMessages,
        messageCount: normalizedMessages.length,
        latestBody: normalizeString((latest.raw && latest.raw.body) || ''),
        latestMs: latest.ms || 0,
        latestCreatedAt: latest.raw && latest.raw.createdAt ? latest.raw.createdAt : null,
        unread: unreadCount > 0,
        unreadCount: unreadCount,
        mode: mode
      };
    });

    threads.sort(function (a, b) { return (b.latestMs || 0) - (a.latestMs || 0); });
    return threads;
  }

  function normalizePublicMessageDoc(id, data) {
    var raw = data || {};
    var body = normalizeString(raw.body);
    var subject = normalizeString(raw.subject) || '(Konu yok)';
    var senderType = normalizeString(raw.senderType).toLowerCase();
    var senderUid = normalizeString(raw.senderUid);
    var recipientUid = normalizeString(raw.recipientUid);
    var senderName = normalizeString(raw.senderName);
    if (!senderName || senderType === 'super_admin') {
      senderName = PLATFORM_SENDER_LABEL;
    }
    var isIncoming = !!recipientUid;
    if (senderType === 'public_user') isIncoming = false;
    if (normalizeString(raw.messageChannel) === 'platform_to_public_user' || senderType === 'super_admin') {
      isIncoming = true;
    }
    if (normalizeString(raw.messageChannel) === 'public_to_platform' || senderType === 'public_user') {
      isIncoming = false;
    }
    var deletedForPublicUser = raw.deletedForPublicUser === true;

    return {
      id: normalizeString(id),
      subject: subject,
      body: body,
      senderName: senderName,
      senderType: senderType,
      senderUid: senderUid,
      recipientUid: recipientUid,
      messageChannel: normalizeString(raw.messageChannel),
      replyTargetType: normalizeString(raw.replyTargetType),
      inReplyTo: normalizeString(raw.inReplyTo),
      originalSubject: normalizeString(raw.originalSubject),
      threadId: normalizeString(raw.threadId),
      rootMessageId: normalizeString(raw.rootMessageId),
      parentMessageId: normalizeString(raw.parentMessageId),
      createdAt: raw.createdAt || null,
      createdAtMs: createdAtMillis(raw.createdAt),
      isUnread: deletedForPublicUser ? false : (isIncoming ? raw.isRead !== true : false),
      readAt: raw.readAt || null,
      replyable: deletedForPublicUser ? false : (isIncoming ? isMessageReplyable(raw) : false),
      direction: isIncoming ? 'incoming' : 'sent',
      deletedForPublicUser: deletedForPublicUser
    };
  }

  function sortMessagesDesc(items) {
    return (items || []).slice().sort(function (a, b) {
      return (b.createdAtMs || 0) - (a.createdAtMs || 0);
    });
  }

  async function fetchMessagesSnapshot(messagesRef) {
    try {
      return await messagesRef.orderBy('createdAt', 'desc').limit(FETCH_LIMIT).get();
    } catch (orderErr) {
      console.warn(LOG_PREFIX + ' orderBy failed, using fallback query', orderErr);
      var fallbackSnap = await messagesRef.limit(FETCH_LIMIT).get();
      return fallbackSnap;
    }
  }

  function mapPublicSnapshotToItems(snap) {
    var items = [];
    (snap.docs || []).forEach(function (doc) {
      items.push(normalizePublicMessageDoc(doc.id, doc.data()));
    });
    return sortMessagesDesc(items).slice(0, FETCH_LIMIT);
  }

  function mapSnapshotToItems(snap, uid, tenantDisplayName) {
    var items = [];
    (snap.docs || []).forEach(function (doc) {
      var normalized = normalizeMessageDoc(doc.id, doc.data(), uid, tenantDisplayName);
      if (normalized) items.push(normalized);
    });
    return sortMessagesDesc(items).slice(0, FETCH_LIMIT);
  }

  function buildReplySubject(originalSubject) {
    var subject = normalizeString(originalSubject) || '(Konu yok)';
    if (/^yanıt:/i.test(subject) || /^yanit:/i.test(subject)) return subject;
    return 'Yanıt: ' + subject;
  }

  function getFieldValue() {
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) {
      return window.firebase.firestore.FieldValue.serverTimestamp();
    }
    return new Date();
  }

  async function markMessageReadByStudent(tenantId, messageId, uid) {
    var tid = normalizeString(tenantId);
    var mid = normalizeString(messageId);
    var id = normalizeString(uid);
    if (!tid || !mid || !id) return { ok: false, error: 'missing_context' };

    var db = getDb();
    if (!db) return { ok: false, error: 'db_unavailable' };

    try {
      var ref = db.collection('tenantMailbox').doc(tid).collection('messages').doc(mid);
      var snap = await ref.get();
      if (!snap.exists) return { ok: false, error: 'not_found' };
      var data = snap.data() || {};
      if (normalizeString(data.recipientType).toLowerCase() !== 'student') return { ok: false, error: 'not_recipient' };
      if (normalizeString(data.recipientId) !== id) return { ok: false, error: 'not_owner' };
      if (data.isReadByStudent === true) return { ok: true, skipped: true };
      if (data.deletedForStudent === true) return { ok: true, skipped: true };
      await ref.update({ isReadByStudent: true });
      return { ok: true };
    } catch (e) {
      console.warn(LOG_PREFIX + ' markMessageReadByStudent failed', e);
      return { ok: false, error: e };
    }
  }

  async function sendPlatformMailboxReply(opts) {
    opts = opts || {};
    var uid = normalizeString(opts.uid);
    var body = normalizeString(opts.body);
    var inReplyTo = normalizeString(opts.inReplyTo);
    var originalSubject = normalizeString(opts.originalSubject);
    var senderType = normalizeString(opts.senderType) || 'student';
    var messageChannel = normalizeString(opts.messageChannel) || 'student_to_platform';
    var sentFromContext = normalizeString(opts.sentFromContext) || 'student_web';

    if (!uid || !body || !inReplyTo) {
      return { ok: false, error: 'missing_fields' };
    }

    var db = getDb();
    if (!db) return { ok: false, error: 'db_unavailable' };

    var subject = buildReplySubject(originalSubject);
    var senderName = normalizeString(opts.senderName) || (senderType === 'public_user' ? 'Üye' : 'Öğrenci');
    var senderEmail = normalizeString(opts.senderEmail);
    var payload = {
      subject: subject,
      body: body,
      senderType: senderType,
      senderUid: uid,
      senderName: senderName,
      recipientType: 'super_admin',
      recipientId: 'super_admin',
      replyTargetType: 'super_admin',
      messageChannel: messageChannel,
      sentFromContext: sentFromContext,
      inReplyTo: inReplyTo,
      parentMessageId: normalizeString(opts.parentMessageId) || inReplyTo,
      originalSubject: originalSubject,
      createdAt: getFieldValue(),
      isReadBySuper: false
    };
    var threadId = normalizeString(opts.threadId);
    var rootMessageId = normalizeString(opts.rootMessageId);
    if (threadId) payload.threadId = threadId;
    if (rootMessageId) payload.rootMessageId = rootMessageId;
    if (!payload.threadId && payload.rootMessageId) payload.threadId = payload.rootMessageId;
    if (!payload.rootMessageId && payload.threadId) payload.rootMessageId = payload.threadId;
    if (senderEmail) payload.senderEmail = senderEmail;
    if (opts.sourceTenantId) {
      payload.sourceTenantId = normalizeString(opts.sourceTenantId);
      if (opts.sourceTenantName) payload.sourceTenantName = normalizeString(opts.sourceTenantName);
    } else {
      payload.sourceTenantId = null;
    }

    try {
      await db.collection('platformMailbox').doc('super_admin').collection('messages').add(payload);
      return { ok: true };
    } catch (e) {
      console.warn(LOG_PREFIX + ' sendPlatformMailboxReply failed', e);
      return { ok: false, error: e };
    }
  }

  async function sendStudentMailboxReply(opts) {
    opts = opts || {};
    var tid = normalizeString(opts.tenantId);
    var uid = normalizeString(opts.uid);
    var body = normalizeString(opts.body);
    var inReplyTo = normalizeString(opts.inReplyTo);
    var originalSubject = normalizeString(opts.originalSubject);

    if (!tid || !uid || !body || !inReplyTo) {
      return { ok: false, error: 'missing_fields' };
    }

    var db = getDb();
    if (!db) return { ok: false, error: 'db_unavailable' };

    try {
      var originalRef = db.collection('tenantMailbox').doc(tid).collection('messages').doc(inReplyTo);
      var originalSnap = await originalRef.get();
      if (!originalSnap.exists) return { ok: false, error: 'original_not_found' };
      var originalData = originalSnap.data() || {};
      var originalRecipientType = normalizeString(originalData.recipientType).toLowerCase();
      var originalRecipientId = normalizeString(originalData.recipientId);
      var originalSenderUid = normalizeString(originalData.senderUid);
      var originalChannel = normalizeString(originalData.messageChannel);
      var isIncomingToStudent = originalRecipientType === 'student' && originalRecipientId === uid;
      var isOwnSentToTenant = originalSenderUid === uid && (
        originalChannel === 'student_to_tenant' ||
        (normalizeString(originalData.senderType).toLowerCase() === 'student' && originalRecipientType === 'tenant')
      );
      if (!isIncomingToStudent && !isOwnSentToTenant) {
        return { ok: false, error: 'not_owner' };
      }

      var replyTarget = isOwnSentToTenant ? 'tenant' : resolveReplyTarget(originalData);
      var subject = buildReplySubject(originalSubject || originalData.subject || originalData.originalSubject);
      var senderName = normalizeString(opts.senderName) || 'Öğrenci';
      var senderEmail = normalizeString(opts.senderEmail);

      if (replyTarget === 'super_admin') {
        if (!isIncomingToStudent) {
          return { ok: false, error: 'invalid_original' };
        }
        var platformThread = deriveStudentReplyThreadFields(inReplyTo, originalData);
        if (normalizeString(opts.threadId)) platformThread.threadId = normalizeString(opts.threadId);
        if (normalizeString(opts.rootMessageId)) platformThread.rootMessageId = normalizeString(opts.rootMessageId);
        return await sendPlatformMailboxReply({
          uid: uid,
          body: body,
          inReplyTo: inReplyTo,
          parentMessageId: inReplyTo,
          threadId: platformThread.threadId,
          rootMessageId: platformThread.rootMessageId,
          originalSubject: originalSubject || normalizeString(originalData.subject),
          senderType: 'student',
          senderName: senderName,
          senderEmail: senderEmail,
          sourceTenantId: tid,
          sourceTenantName: normalizeString(opts.tenantDisplayName),
          messageChannel: 'student_to_platform',
          sentFromContext: normalizeString(opts.sentFromContext) || 'student_web'
        });
      }

      var threadFields = deriveStudentReplyThreadFields(inReplyTo, originalData);
      if (normalizeString(opts.threadId)) threadFields.threadId = normalizeString(opts.threadId);
      if (normalizeString(opts.rootMessageId)) threadFields.rootMessageId = normalizeString(opts.rootMessageId);
      threadFields.parentMessageId = inReplyTo;
      threadFields.inReplyTo = inReplyTo;

      await db.collection('tenantMailbox').doc(tid).collection('messages').add({
        tenantId: tid,
        subject: subject,
        body: body,
        senderType: 'student',
        senderUid: uid,
        senderName: senderName,
        senderEmail: senderEmail,
        recipientType: 'tenant',
        recipientId: tid,
        createdAt: getFieldValue(),
        updatedAt: getFieldValue(),
        isReadByStudent: true,
        isReadByTenant: false,
        inReplyTo: threadFields.inReplyTo,
        parentMessageId: threadFields.parentMessageId,
        threadId: threadFields.threadId,
        rootMessageId: threadFields.rootMessageId,
        originalSubject: originalSubject || normalizeString(originalData.originalSubject || originalData.subject),
        messageChannel: 'student_to_tenant',
        sentFromContext: normalizeString(opts.sentFromContext) || 'student_web',
        replyTargetType: 'tenant',
        isRead: false
      });

      return { ok: true };
    } catch (e) {
      console.warn(LOG_PREFIX + ' sendStudentMailboxReply failed', e);
      return { ok: false, error: e };
    }
  }

  async function sendPublicUserMailboxReply(opts) {
    opts = opts || {};
    var uid = normalizeString(opts.uid);
    var body = normalizeString(opts.body);
    var inReplyTo = normalizeString(opts.inReplyTo);
    var originalSubject = normalizeString(opts.originalSubject);

    if (!uid || !body || !inReplyTo) {
      return { ok: false, error: 'missing_fields' };
    }

    var db = getDb();
    if (!db) return { ok: false, error: 'db_unavailable' };

    try {
      var originalRef = db.collection('userMailbox').doc(uid).collection('messages').doc(inReplyTo);
      var originalSnap = await originalRef.get();
      if (!originalSnap.exists) return { ok: false, error: 'original_not_found' };
      var originalData = originalSnap.data() || {};
      if (normalizeString(originalData.recipientUid) !== uid) {
        return { ok: false, error: 'not_owner' };
      }
      if (!isMessageReplyable(originalData)) {
        return { ok: false, error: 'not_replyable' };
      }

      var threadFields = deriveStudentReplyThreadFields(inReplyTo, originalData);
      if (normalizeString(opts.threadId)) threadFields.threadId = normalizeString(opts.threadId);
      if (normalizeString(opts.rootMessageId)) threadFields.rootMessageId = normalizeString(opts.rootMessageId);

      return await sendPlatformMailboxReply({
        uid: uid,
        body: body,
        inReplyTo: inReplyTo,
        parentMessageId: inReplyTo,
        threadId: threadFields.threadId,
        rootMessageId: threadFields.rootMessageId,
        originalSubject: originalSubject || normalizeString(originalData.subject),
        senderType: 'public_user',
        senderName: normalizeString(opts.senderName) || 'Üye',
        senderEmail: normalizeString(opts.senderEmail),
        messageChannel: 'public_to_platform',
        sentFromContext: normalizeString(opts.sentFromContext) || 'public_web'
      });
    } catch (e) {
      console.warn(LOG_PREFIX + ' sendPublicUserMailboxReply failed', e);
      return { ok: false, error: e };
    }
  }

  async function markPublicUserMessageRead(uid, messageId) {
    var id = normalizeString(uid);
    var mid = normalizeString(messageId);
    if (!id || !mid) return { ok: false, error: 'missing_context' };

    var db = getDb();
    if (!db) return { ok: false, error: 'db_unavailable' };

    try {
      var ref = db.collection('userMailbox').doc(id).collection('messages').doc(mid);
      var snap = await ref.get();
      if (!snap.exists) return { ok: false, error: 'not_found' };
      var data = snap.data() || {};
      if (normalizeString(data.recipientUid) !== id) return { ok: false, error: 'not_owner' };
      if (data.deletedForPublicUser === true) return { ok: true, skipped: true };
      if (data.isRead === true) return { ok: true, skipped: true };
      await ref.update({
        isRead: true,
        readAt: getFieldValue()
      });
      return { ok: true };
    } catch (e) {
      console.warn(LOG_PREFIX + ' markPublicUserMessageRead failed', e);
      return { ok: false, error: e };
    }
  }

  function timestampMillis(ts) {
    return createdAtMillis(ts);
  }

  function isPublicIncomingRaw(raw) {
    var d = raw || {};
    var ch = normalizeString(d.messageChannel);
    var st = normalizeString(d.senderType).toLowerCase();
    if (ch === 'public_to_platform' || st === 'public_user') return false;
    if (ch === 'platform_to_public_user' || st === 'super_admin' || st === 'platform') return true;
    return false;
  }

  function applyPublicSoftHideFilters(threads, docsById, threadStates) {
    var states = threadStates || {};
    var map = docsById || {};
    return (threads || []).map(function (thread) {
      var tid = normalizeString(thread && thread.threadId);
      var state = states[tid] || null;
      var hiddenAtMs = 0;
      var isHiddenThread = !!(state && state.hidden === true);
      if (isHiddenThread) {
        hiddenAtMs = timestampMillis(state.hiddenAt);
        var hasNewerIncoming = (thread.messages || []).some(function (msg) {
          var raw = map[msg.id] || {};
          if (raw.deletedForPublicUser === true) return false;
          if (!isPublicIncomingRaw(raw)) return false;
          return timestampMillis(raw.createdAt) > hiddenAtMs;
        });
        if (!hasNewerIncoming) return null;
      }

      var visible = (thread.messages || []).filter(function (msg) {
        var raw = map[msg.id] || {};
        if (raw.deletedForPublicUser === true || msg.deletedForPublicUser === true) return false;
        if (isHiddenThread && timestampMillis(raw.createdAt || msg.createdAt) <= hiddenAtMs) return false;
        return true;
      });
      if (!visible.length) return null;

      var unreadCount = 0;
      visible.forEach(function (msg) {
        if (msg.isUnread) unreadCount++;
      });
      var latest = visible[visible.length - 1] || {};
      return Object.assign({}, thread, {
        messages: visible,
        messageCount: visible.length,
        latestBody: normalizeString(latest.body || ''),
        latestMs: latest.createdAtMs || 0,
        latestCreatedAt: latest.createdAt || null,
        unread: unreadCount > 0,
        unreadCount: unreadCount
      });
    }).filter(Boolean);
  }

  async function fetchPublicThreadStates(uid) {
    var id = normalizeString(uid);
    var db = getDb();
    var out = {};
    if (!id || !db) return out;
    try {
      var snap = await db.collection('userMailbox').doc(id).collection('threadStates').limit(100).get();
      (snap.docs || []).forEach(function (doc) {
        out[doc.id] = doc.data() || {};
      });
    } catch (e) {
      console.warn(LOG_PREFIX + ' fetchPublicThreadStates failed', e);
    }
    return out;
  }

  async function hidePublicUserMessage(uid, messageId) {
    var id = normalizeString(uid);
    var mid = normalizeString(messageId);
    if (!id || !mid) return { ok: false, error: 'missing_context' };
    var db = getDb();
    if (!db) return { ok: false, error: 'db_unavailable' };
    try {
      await db.collection('userMailbox').doc(id).collection('messages').doc(mid).update({
        deletedForPublicUser: true,
        deletedAtForPublicUser: getFieldValue(),
        deletedByPublicUid: id,
        updatedAt: getFieldValue()
      });
      return { ok: true };
    } catch (e) {
      console.warn(LOG_PREFIX + ' hidePublicUserMessage failed', e);
      return { ok: false, error: e };
    }
  }

  async function hidePublicUserThread(uid, threadId) {
    var id = normalizeString(uid);
    var tid = normalizeString(threadId);
    if (!id || !tid) return { ok: false, error: 'missing_context' };
    var db = getDb();
    if (!db) return { ok: false, error: 'db_unavailable' };
    try {
      await db.collection('userMailbox').doc(id).collection('threadStates').doc(tid).set({
        threadId: tid,
        hidden: true,
        hiddenAt: getFieldValue(),
        hiddenByUid: id,
        mailboxScope: 'public_userMailbox',
        resurfaceOnIncoming: true,
        updatedAt: getFieldValue()
      }, { merge: true });
      return { ok: true };
    } catch (e) {
      console.warn(LOG_PREFIX + ' hidePublicUserThread failed', e);
      return { ok: false, error: e };
    }
  }

  function isStudentIncomingRaw(raw, uid) {
    var d = raw || {};
    var ch = normalizeString(d.messageChannel);
    var st = normalizeString(d.senderType).toLowerCase();
    var rt = normalizeString(d.recipientType).toLowerCase();
    var rid = normalizeString(d.recipientId);
    if (ch === 'student_to_tenant' || ch === 'student_to_platform' || st === 'student') return false;
    if (rid && rid !== normalizeString(uid)) return false;
    if (ch === 'tenant_to_student' || ch === 'platform_to_student') return true;
    if ((st === 'institution_admin' || st === 'super_admin' || st === 'platform') && rt === 'student') return true;
    return false;
  }

  function applyStudentSoftHideFilters(threads, docsById, threadStates, uid) {
    var states = threadStates || {};
    var map = docsById || {};
    var id = normalizeString(uid);
    return (threads || []).map(function (thread) {
      var tid = normalizeString(thread && thread.threadId);
      var state = states[tid] || null;
      var hiddenAtMs = 0;
      var isHiddenThread = !!(state && state.hidden === true);
      if (isHiddenThread) {
        hiddenAtMs = timestampMillis(state.hiddenAt);
        var hasNewerIncoming = (thread.messages || []).some(function (msg) {
          var raw = map[msg.id] || {};
          if (raw.deletedForStudent === true) return false;
          if (!isStudentIncomingRaw(raw, id)) return false;
          return timestampMillis(raw.createdAt) > hiddenAtMs;
        });
        if (!hasNewerIncoming) return null;
      }

      var visible = (thread.messages || []).filter(function (msg) {
        var raw = map[msg.id] || {};
        if (raw.deletedForStudent === true || msg.deletedForStudent === true) return false;
        if (isHiddenThread && timestampMillis(raw.createdAt || msg.createdAt) <= hiddenAtMs) return false;
        return true;
      });
      if (!visible.length) return null;

      var unreadCount = 0;
      visible.forEach(function (msg) {
        if (msg.isUnread) unreadCount++;
      });
      var latest = visible[visible.length - 1] || {};
      return Object.assign({}, thread, {
        messages: visible,
        messageCount: visible.length,
        latestBody: normalizeString(latest.body || ''),
        latestMs: latest.createdAtMs || 0,
        latestCreatedAt: latest.createdAt || null,
        unread: unreadCount > 0,
        unreadCount: unreadCount
      });
    }).filter(Boolean);
  }

  async function fetchStudentThreadStates(uid) {
    var id = normalizeString(uid);
    var db = getDb();
    var out = {};
    if (!id || !db) return out;
    try {
      var snap = await db.collection('users').doc(id).collection('mailboxThreadStates').limit(100).get();
      (snap.docs || []).forEach(function (doc) {
        out[doc.id] = doc.data() || {};
      });
    } catch (e) {
      console.warn(LOG_PREFIX + ' fetchStudentThreadStates failed', e);
    }
    return out;
  }

  async function hideStudentMessage(tenantId, uid, messageId) {
    var tid = normalizeString(tenantId);
    var id = normalizeString(uid);
    var mid = normalizeString(messageId);
    if (!tid || !id || !mid) return { ok: false, error: 'missing_context' };
    var db = getDb();
    if (!db) return { ok: false, error: 'db_unavailable' };
    try {
      await db.collection('tenantMailbox').doc(tid).collection('messages').doc(mid).update({
        deletedForStudent: true,
        deletedAtForStudent: getFieldValue(),
        deletedByStudentUid: id,
        updatedAt: getFieldValue()
      });
      return { ok: true };
    } catch (e) {
      console.warn(LOG_PREFIX + ' hideStudentMessage failed', e);
      return { ok: false, error: e };
    }
  }

  async function hideStudentThread(uid, threadId, tenantId) {
    var id = normalizeString(uid);
    var tid = normalizeString(threadId);
    var tenant = normalizeString(tenantId);
    if (!id || !tid) return { ok: false, error: 'missing_context' };
    var db = getDb();
    if (!db) return { ok: false, error: 'db_unavailable' };
    try {
      var payload = {
        threadId: tid,
        hidden: true,
        hiddenAt: getFieldValue(),
        hiddenByUid: id,
        mailboxScope: 'student_tenantMailbox',
        resurfaceOnIncoming: true,
        updatedAt: getFieldValue()
      };
      if (tenant) payload.tenantId = tenant;
      await db.collection('users').doc(id).collection('mailboxThreadStates').doc(tid).set(payload, { merge: true });
      return { ok: true };
    } catch (e) {
      console.warn(LOG_PREFIX + ' hideStudentThread failed', e);
      return { ok: false, error: e };
    }
  }

  async function getPublicUserMessages(uid) {
    var id = normalizeString(uid);
    if (!id) {
      return { ok: false, items: [], threads: [], docsById: {}, threadStates: {}, error: 'missing_context' };
    }

    var db = getDb();
    if (!db) {
      return { ok: false, items: [], threads: [], docsById: {}, threadStates: {}, error: 'db_unavailable' };
    }

    try {
      var messagesRef = db.collection('userMailbox').doc(id).collection('messages');
      var snap = await fetchMessagesSnapshot(messagesRef);
      var docsById = {};
      (snap.docs || []).forEach(function (doc) {
        docsById[doc.id] = doc.data() || {};
      });
      var threadStates = await fetchPublicThreadStates(id);
      var items = mapPublicSnapshotToItems(snap).filter(function (item) {
        return !(item && item.deletedForPublicUser);
      });
      var threads = buildConversationThreadsFromDocs(docsById, {
        mode: 'public',
        uid: id
      });
      threads = applyPublicSoftHideFilters(threads, docsById, threadStates);
      return { ok: true, items: items, threads: threads, docsById: docsById, threadStates: threadStates, error: null };
    } catch (e) {
      console.warn(LOG_PREFIX + ' getPublicUserMessages failed', e);
      return { ok: false, items: [], threads: [], docsById: {}, threadStates: {}, error: e };
    }
  }

  async function getStudentMessages(tenantId, uid, opts) {
    opts = opts || {};
    var tid = normalizeString(tenantId);
    var id = normalizeString(uid);
    var tenantDisplayName = normalizeString(opts.tenantDisplayName);

    if (!tid || !id) {
      return { ok: false, items: [], threads: [], platformItems: [], docsById: {}, error: 'missing_context' };
    }

    var db = getDb();
    if (!db) {
      return { ok: false, items: [], threads: [], platformItems: [], docsById: {}, error: 'db_unavailable' };
    }

    // Own incoming + own sent (M2A-Fix). Never fall back to an unfiltered tenantMailbox list.
    try {
      var coll = db.collection('tenantMailbox').doc(tid).collection('messages');
      var incomingSnap = await coll
        .where('recipientId', '==', id)
        .where('recipientType', '==', 'student')
        .orderBy('createdAt', 'desc')
        .limit(FETCH_LIMIT)
        .get();

      var sentSnap = null;
      var sentError = null;
      try {
        sentSnap = await coll
          .where('senderUid', '==', id)
          .orderBy('createdAt', 'desc')
          .limit(FETCH_LIMIT)
          .get();
      } catch (sentErr) {
        sentError = sentErr;
        console.warn(LOG_PREFIX + ' getStudentMessages sent query failed', sentErr);
      }

      var docsById = {};
      function absorbSnap(snap) {
        if (!snap || !snap.docs) return;
        snap.docs.forEach(function (doc) {
          var data = doc.data() || {};
          if (!isOwnStudentMailboxDoc(data, id)) return;
          docsById[doc.id] = data;
        });
      }
      absorbSnap(incomingSnap);
      absorbSnap(sentSnap);

      var threads = buildConversationThreadsFromDocs(docsById, {
        mode: 'institution',
        uid: id,
        tenantDisplayName: tenantDisplayName
      });
      var threadStates = await fetchStudentThreadStates(id);
      threads = applyStudentSoftHideFilters(threads, docsById, threadStates, id);

      var platformItems = [];
      var items = [];
      Object.keys(docsById).forEach(function (docId) {
        var data = docsById[docId] || {};
        if (data.deletedForStudent === true) return;
        var recipientType = normalizeString(data.recipientType).toLowerCase();
        var recipientId = normalizeString(data.recipientId);
        if (!(recipientType === 'student' && recipientId === id)) return;
        var normalized = normalizeMessageDoc(docId, data, id, tenantDisplayName);
        if (!normalized) return;
        items.push(normalized);
        if (!isStudentConversationRaw(data)) {
          platformItems.push(normalized);
        }
      });
      items = sortMessagesDesc(items).slice(0, FETCH_LIMIT);
      platformItems = sortMessagesDesc(platformItems).slice(0, FETCH_LIMIT);

      return {
        ok: true,
        items: items,
        threads: threads,
        platformItems: platformItems,
        docsById: docsById,
        threadStates: threadStates,
        error: null,
        sentQueryError: sentError || null
      };
    } catch (e) {
      console.warn(LOG_PREFIX + ' getStudentMessages failed', e);
      return { ok: false, items: [], threads: [], platformItems: [], docsById: {}, error: e };
    }
  }

  var studentMailboxListenerState = {
    tenantId: '',
    uid: '',
    tenantDisplayName: '',
    unsubs: [],
    incomingDocs: {},
    sentDocs: {},
    threadStates: {}
  };

  function stopStudentMailboxListener() {
    (studentMailboxListenerState.unsubs || []).forEach(function (unsub) {
      try {
        if (typeof unsub === 'function') unsub();
      } catch (_) {}
    });
    studentMailboxListenerState.unsubs = [];
    studentMailboxListenerState.tenantId = '';
    studentMailboxListenerState.uid = '';
    studentMailboxListenerState.tenantDisplayName = '';
    studentMailboxListenerState.incomingDocs = {};
    studentMailboxListenerState.sentDocs = {};
    studentMailboxListenerState.threadStates = {};
  }

  function buildStudentMailboxPayloadFromDocs(docsById, threadStates, uid, tenantDisplayName) {
    var id = normalizeString(uid);
    var map = docsById || {};
    var threads = buildConversationThreadsFromDocs(map, {
      mode: 'institution',
      uid: id,
      tenantDisplayName: normalizeString(tenantDisplayName)
    });
    threads = applyStudentSoftHideFilters(threads, map, threadStates || {}, id);

    var platformItems = [];
    var items = [];
    Object.keys(map).forEach(function (docId) {
      var data = map[docId] || {};
      if (data.deletedForStudent === true) return;
      var recipientType = normalizeString(data.recipientType).toLowerCase();
      var recipientId = normalizeString(data.recipientId);
      if (!(recipientType === 'student' && recipientId === id)) return;
      var normalized = normalizeMessageDoc(docId, data, id, tenantDisplayName);
      if (!normalized) return;
      items.push(normalized);
      if (!isStudentConversationRaw(data)) {
        platformItems.push(normalized);
      }
    });
    items.sort(function (a, b) { return (b.createdAtMs || 0) - (a.createdAtMs || 0); });
    platformItems.sort(function (a, b) { return (b.createdAtMs || 0) - (a.createdAtMs || 0); });

    var unreadCount = 0;
    (threads || []).forEach(function (t) {
      unreadCount += Number(t && t.unreadCount) || 0;
    });
    (platformItems || []).forEach(function (item) {
      if (item && item.isUnread) unreadCount++;
    });

    return {
      ok: true,
      items: items,
      threads: threads,
      platformItems: platformItems,
      docsById: map,
      threadStates: threadStates || {},
      unreadCount: unreadCount,
      error: null
    };
  }

  function countStudentUnreadFromPayload(payload) {
    if (!payload) return 0;
    if (typeof payload.unreadCount === 'number') return payload.unreadCount;
    var n = 0;
    (payload.threads || []).forEach(function (t) {
      n += Number(t && t.unreadCount) || 0;
    });
    (payload.platformItems || []).forEach(function (item) {
      if (item && item.isUnread) n++;
    });
    return n;
  }

  async function startStudentMailboxListener(tenantId, uid, opts, onUpdate) {
    opts = opts || {};
    var tid = normalizeString(tenantId);
    var id = normalizeString(uid);
    var tenantDisplayName = normalizeString(opts.tenantDisplayName);
    if (!tid || !id || typeof onUpdate !== 'function') {
      return { ok: false, error: 'missing_context' };
    }
    var db = getDb();
    if (!db) return { ok: false, error: 'db_unavailable' };

    if (
      studentMailboxListenerState.tenantId === tid &&
      studentMailboxListenerState.uid === id &&
      studentMailboxListenerState.unsubs &&
      studentMailboxListenerState.unsubs.length
    ) {
      return { ok: true, reused: true };
    }

    stopStudentMailboxListener();
    studentMailboxListenerState.tenantId = tid;
    studentMailboxListenerState.uid = id;
    studentMailboxListenerState.tenantDisplayName = tenantDisplayName;
    studentMailboxListenerState.incomingDocs = {};
    studentMailboxListenerState.sentDocs = {};
    studentMailboxListenerState.threadStates = await fetchStudentThreadStates(id);

    var coll = db.collection('tenantMailbox').doc(tid).collection('messages');
    var emitScheduled = false;

    function mergeAndEmit() {
      if (studentMailboxListenerState.tenantId !== tid || studentMailboxListenerState.uid !== id) return;
      var docsById = {};
      Object.keys(studentMailboxListenerState.incomingDocs || {}).forEach(function (docId) {
        docsById[docId] = studentMailboxListenerState.incomingDocs[docId];
      });
      Object.keys(studentMailboxListenerState.sentDocs || {}).forEach(function (docId) {
        docsById[docId] = studentMailboxListenerState.sentDocs[docId];
      });
      var payload = buildStudentMailboxPayloadFromDocs(
        docsById,
        studentMailboxListenerState.threadStates,
        id,
        studentMailboxListenerState.tenantDisplayName
      );
      try {
        onUpdate(payload);
      } catch (e) {
        console.warn(LOG_PREFIX + ' student mailbox listener onUpdate failed', e);
      }
    }

    function scheduleEmit() {
      if (emitScheduled) return;
      emitScheduled = true;
      setTimeout(function () {
        emitScheduled = false;
        mergeAndEmit();
      }, 0);
    }

    function absorbInto(target, snap) {
      var next = {};
      (snap && snap.docs ? snap.docs : []).forEach(function (doc) {
        var data = doc.data() || {};
        if (!isOwnStudentMailboxDoc(data, id)) return;
        next[doc.id] = data;
      });
      return next;
    }

    var incomingQuery = coll
      .where('recipientId', '==', id)
      .where('recipientType', '==', 'student')
      .orderBy('createdAt', 'desc')
      .limit(FETCH_LIMIT);

    var incomingUnsub = incomingQuery.onSnapshot(
      function (snap) {
        studentMailboxListenerState.incomingDocs = absorbInto(studentMailboxListenerState.incomingDocs, snap);
        scheduleEmit();
      },
      function (err) {
        console.warn(LOG_PREFIX + ' student incoming listener failed', err);
      }
    );
    studentMailboxListenerState.unsubs.push(incomingUnsub);

    try {
      var sentQuery = coll
        .where('senderUid', '==', id)
        .orderBy('createdAt', 'desc')
        .limit(FETCH_LIMIT);
      var sentUnsub = sentQuery.onSnapshot(
        function (snap) {
          studentMailboxListenerState.sentDocs = absorbInto(studentMailboxListenerState.sentDocs, snap);
          scheduleEmit();
        },
        function (err) {
          console.warn(LOG_PREFIX + ' student sent listener failed', err);
        }
      );
      studentMailboxListenerState.unsubs.push(sentUnsub);
    } catch (sentErr) {
      console.warn(LOG_PREFIX + ' student sent listener setup failed', sentErr);
    }

    return { ok: true };
  }

  window.SA_WEB_PROFILE_MESSAGES_REPOSITORY = {
    getStudentMessages: getStudentMessages,
    getPublicUserMessages: getPublicUserMessages,
    markMessageReadByStudent: markMessageReadByStudent,
    markPublicUserMessageRead: markPublicUserMessageRead,
    hidePublicUserMessage: hidePublicUserMessage,
    hidePublicUserThread: hidePublicUserThread,
    hideStudentMessage: hideStudentMessage,
    hideStudentThread: hideStudentThread,
    sendStudentMailboxReply: sendStudentMailboxReply,
    sendPublicUserMailboxReply: sendPublicUserMailboxReply,
    resolveReplyTarget: resolveReplyTarget,
    isMessageReplyable: isMessageReplyable,
    deriveWebMailboxThreadId: deriveWebMailboxThreadId,
    buildConversationThreadsFromDocs: buildConversationThreadsFromDocs,
    cleanWebMailboxDisplaySubject: cleanWebMailboxDisplaySubject,
    startStudentMailboxListener: startStudentMailboxListener,
    stopStudentMailboxListener: stopStudentMailboxListener,
    countStudentUnreadFromPayload: countStudentUnreadFromPayload
  };
})();
