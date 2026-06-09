import 'react-native-url-polyfill/auto';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

const RECORD_FILE = `${FileSystem.documentDirectory}mood-records.json`;
const RESET_MARKER_FILE = `${FileSystem.documentDirectory}records-reset-2026-06-05-weather.json`;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

const MOODS = [
  { key: 'happy', emoji: '😊', label: '开心', detail: '开心/愉悦', color: '#ffd166' },
  { key: 'angry', emoji: '😡', label: '暴躁', detail: '愤怒/暴躁', color: '#ff8a80' },
  { key: 'sad', emoji: '😭', label: '难过', detail: '难过/委屈', color: '#8ec5ff' },
  { key: 'down', emoji: '😞', label: '丧', detail: '丧/低落', color: '#a7a9be' },
  { key: 'calm', emoji: '😌', label: '平静', detail: '平静/稳定', color: '#8ee0b7' },
  { key: 'tired', emoji: '😴', label: '困倦', detail: '困倦/无动力', color: '#c6b6ff' },
];

const DEFAULT_REMINDER_MESSAGE = 'emomo 到点，现在的你是什么情绪？';

const RANGE_OPTIONS = [
  { key: '7d', label: '7天', days: 7 },
  { key: '30d', label: '30天', days: 30 },
  { key: '90d', label: '90天', days: 90 },
  { key: '12m', label: '12月', days: 365 },
];

const DEFAULT_REMINDER_TIMES = [
  { id: 'afternoon', hour: 15, minute: 0 },
  { id: 'night', hour: 21, minute: 0 },
];

const WEATHER_REFRESH_MS = 30 * 60 * 1000;

const REGULATION_TIPS = {
  ok: [
    '看向远处 30 秒。',
    '喝一口水，慢一点。',
    '换一个更舒服的姿势。',
  ],
  watch: [
    '慢慢呼吸 5 次。',
    '把肩膀轻轻放下来。',
    '离开屏幕 3 分钟。',
  ],
  care: [
    '先停在原地 1 分钟。',
    '闭眼待一会儿。',
    '找一个安静一点的位置。',
  ],
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function App() {
  const [records, setRecords] = useState([]);
  const recordsRef = useRef([]);
  const [tab, setTab] = useState('capture');
  const [burst, setBurst] = useState(null);
  const [savedMood, setSavedMood] = useState(null);
  const [canvasToast, setCanvasToast] = useState(null);
  const [settingsToast, setSettingsToast] = useState(null);
  const [reminderTimes, setReminderTimes] = useState(DEFAULT_REMINDER_TIMES);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderMessage, setReminderMessage] = useState(DEFAULT_REMINDER_MESSAGE);
  const [recordsReady, setRecordsReady] = useState(false);
  const [weather, setWeather] = useState(null);
  const [session, setSession] = useState(null);
  const [syncEmail, setSyncEmail] = useState('');
  const [syncToast, setSyncToast] = useState(
    supabase ? 'Supabase ready. Sign in to sync.' : 'Supabase is not configured.'
  );
  const weatherRef = useRef(null);

  useEffect(() => {
    prepareRecords().then((loadedRecords) => {
      setRecords(loadedRecords);
      setRecordsReady(true);
    });
  }, []);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    weatherRef.current = weather;
  }, [weather]);

  const applyCloudSync = useCallback(async (activeSession) => {
    if (!activeSession) {
      setSyncToast('Sign in before syncing.');
      return;
    }

    const result = await syncRecordsWithCloud(recordsRef.current, activeSession);
    if (!result.ok) {
      setSyncToast(result.message);
      return;
    }

    recordsRef.current = result.records;
    setRecords(result.records);
    await saveRecords(result.records);
    setSyncToast(result.message);
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) {
        setSyncEmail(data.session.user.email || '');
        setSyncToast(`Signed in: ${data.session.user.email || 'Supabase user'}`);
        applyCloudSync(data.session);
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        setSyncEmail(nextSession.user.email || '');
        setSyncToast(`Signed in: ${nextSession.user.email || 'Supabase user'}`);
        applyCloudSync(nextSession);
      } else {
        setSyncToast('Signed out.');
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [applyCloudSync]);

  useEffect(() => {
    let mounted = true;

    async function refreshWeather() {
      const nextWeather = await loadLocalWeather();
      if (mounted) setWeather(nextWeather);
    }

    refreshWeather();
    const timer = setInterval(refreshWeather, WEATHER_REFRESH_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const addRecord = useCallback(async (mood, x, y) => {
    const nextRecord = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: Date.now(),
      emoji: mood.emoji,
      tag: '',
      weather: weatherRef.current?.status === 'ready' ? weatherRef.current.data : null,
    };
    const nextRecords = [...recordsRef.current, nextRecord];

    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    await saveRecords(nextRecords);
    await pushRecordToCloud(nextRecord, session);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    setBurst({ id: nextRecord.id, x, y, color: mood.color });
    setSavedMood(mood);
    setTimeout(() => setSavedMood(null), 500);
  }, [session]);

  useEffect(() => {
    if (!recordsReady) return undefined;

    const handleUrl = async (url) => {
      const authSession = await completeSupabaseUrl(url);
      if (authSession) {
        setSession(authSession);
        setSyncToast(`Signed in: ${authSession.user.email || 'Supabase user'}`);
        applyCloudSync(authSession);
        return;
      }

      const mood = moodFromShortcutUrl(url);
      if (!mood) return;
      addRecord(mood, SCREEN_WIDTH / 2, 420);
      setCanvasToast(`已通过快捷指令记录：${mood.label}`);
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    const subscription = Linking.addEventListener('url', (event) => {
      handleUrl(event.url);
    });

    return () => subscription.remove();
  }, [addRecord, applyCloudSync, recordsReady]);

  const toggleNotifications = useCallback(async () => {
    try {
      const nextEnabled = !reminderEnabled;
      const message = nextEnabled
        ? await scheduleMoodNotifications(reminderTimes, reminderMessage)
        : await cancelMoodNotifications();
      setReminderEnabled(nextEnabled);
      setSettingsToast(message);
    } catch (error) {
      setSettingsToast('提醒设置失败，请检查系统权限');
    }
  }, [reminderEnabled, reminderMessage, reminderTimes]);

  const sendLoginLink = useCallback(async () => {
    if (!supabase) {
      setSyncToast('Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
      return;
    }

    const email = syncEmail.trim();
    if (!email) {
      setSyncToast('Enter an email first.');
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: 'emomo://auth',
      },
    });

    setSyncToast(error ? `Login link failed: ${error.message}` : 'Login link sent. Open it on this iPhone.');
  }, [syncEmail]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setSyncToast('Signed out.');
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.app}>
        <Header tab={tab} setTab={setTab} />
        {tab === 'capture' ? (
          <CaptureScreen onCapture={addRecord} />
        ) : tab === 'canvas' ? (
          <CanvasScreen
            records={records}
            toast={canvasToast}
            weather={weather}
            onCapture={addRecord}
          />
        ) : (
          <SettingsScreen
            reminderEnabled={reminderEnabled}
            reminderTimes={reminderTimes}
            reminderMessage={reminderMessage}
            settingsToast={settingsToast}
            setReminderTimes={setReminderTimes}
            setReminderMessage={setReminderMessage}
            onToggleNotifications={toggleNotifications}
            session={session}
            syncEmail={syncEmail}
            syncToast={syncToast}
            setSyncEmail={setSyncEmail}
            onSendLoginLink={sendLoginLink}
            onSignOut={signOut}
            onSyncNow={() => applyCloudSync(session)}
          />
        )}
      </View>

      {burst ? <ParticleBurst burst={burst} onDone={() => setBurst(null)} /> : null}
      {savedMood ? <SavedOverlay mood={savedMood} /> : null}
    </SafeAreaView>
  );
}

function Header({ tab, setTab }) {
  return (
    <View style={styles.header}>
      <Pressable style={styles.brand} onPress={() => setTab('capture')}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>em</Text>
        </View>
        <Text style={styles.brandText}>emomo</Text>
      </Pressable>

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, tab === 'capture' && styles.tabActive]}
          onPress={() => setTab('capture')}
        >
          <Text style={[styles.tabText, tab === 'capture' && styles.tabTextActive]}>记录</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === 'canvas' && styles.tabActive]}
          onPress={() => setTab('canvas')}
        >
          <Text style={[styles.tabText, tab === 'canvas' && styles.tabTextActive]}>画布</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === 'settings' && styles.tabActive]}
          onPress={() => setTab('settings')}
        >
          <Text style={[styles.tabText, tab === 'settings' && styles.tabTextActive]}>设置</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CaptureScreen({ onCapture }) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.capture}>
      <Text style={styles.timeChip}>
        {time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
      </Text>
      <Text style={styles.title}>现在是什么情绪？</Text>
      <View style={styles.moodGrid}>
        {MOODS.map((mood) => (
          <MoodButton key={mood.emoji} mood={mood} onCapture={onCapture} />
        ))}
      </View>
    </View>
  );
}

function MoodButton({ mood, onCapture }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.moodButton,
        pressed && styles.moodButtonPressed,
      ]}
      onPress={(event) => {
        const { pageX, pageY } = event.nativeEvent;
        onCapture(mood, pageX || SCREEN_WIDTH / 2, pageY || 380);
      }}
    >
      <Text style={styles.moodEmoji}>{mood.emoji}</Text>
      <Text style={styles.moodLabel}>{mood.label}</Text>
    </Pressable>
  );
}

function SavedOverlay({ mood }) {
  return (
    <View style={styles.savedOverlay} pointerEvents="none">
      <Text style={styles.savedEmoji}>{mood.emoji}</Text>
      <Text style={styles.savedText}>已记录</Text>
    </View>
  );
}

function ParticleBurst({ burst, onDone }) {
  const progress = useRef(new Animated.Value(0)).current;
  const particles = useMemo(() => {
    return Array.from({ length: 38 }, (_, index) => {
      const angle = seeded(index + 8) * Math.PI * 2;
      const distance = 72 + seeded(index + 31) * 150;
      return {
        id: index,
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        size: 5 + seeded(index + 71) * 10,
      };
    });
  }, [burst.id]);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 640,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(onDone);
  }, [onDone, progress]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((particle) => {
        const translateX = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, particle.dx],
        });
        const translateY = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, particle.dy],
        });
        const opacity = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 0],
        });

        return (
          <Animated.View
            key={particle.id}
            style={[
              styles.particle,
              {
                left: burst.x,
                top: burst.y,
                width: particle.size,
                height: particle.size,
                backgroundColor: burst.color,
                opacity,
                transform: [{ translateX }, { translateY }, { scale: opacity }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function CanvasScreen({ records, toast, weather, onCapture }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const [rangeKey, setRangeKey] = useState('30d');
  const selectedRange = RANGE_OPTIONS.find((option) => option.key === rangeKey) || RANGE_OPTIONS[1];
  const filteredRecords = useMemo(
    () => filterRecordsByRange(records, selectedRange.days),
    [records, selectedRange.days]
  );
  const dayMap = useMemo(() => groupRecordsByDay(filteredRecords), [filteredRecords]);
  const weeks = useMemo(() => buildCalendarWeeks(selectedRange.days), [selectedRange.days]);
  const monthLabels = useMemo(() => buildMonthLabels(weeks), [weeks]);
  const rangeText = useMemo(() => formatRangeText(selectedRange.days), [selectedRange.days]);
  const recentRecords = useMemo(() => sortRecords(filteredRecords).slice(-5).reverse(), [filteredRecords]);
  const moodWeather = useMemo(() => analyzeMood(records), [records]);

  const detail = useMemo(() => {
    if (toast) return toast;
    if (!selectedDay) {
      return filteredRecords.length ? '点击一个格子查看当天所有记录' : '这个时间范围还没有记录。';
    }
    const dayRecords = sortRecords(dayMap[selectedDay]);
    if (!dayRecords.length) return `${formatDayTitle(selectedDay)} 未记录`;
    return dayRecords
      .map((record) => {
        const weatherText = formatRecordWeather(record.weather);
        return `${formatDayTitle(selectedDay)}  ${record.emoji} ${formatRecordClock(record.timestamp)}  ${weatherText}`;
      })
      .join('\n');
  }, [dayMap, filteredRecords.length, selectedDay, toast]);

  return (
    <ScrollView style={styles.canvas} contentContainerStyle={styles.canvasContent}>
      <View style={styles.canvasHeader}>
        <View>
          <Text style={styles.kicker}>过去 {selectedRange.label}</Text>
          <Text style={styles.canvasTitle}>情绪像素画布</Text>
        </View>
      </View>

      <View style={styles.rangeSummary}>
        <Text style={styles.rangeSummaryText}>{rangeText}</Text>
      </View>

      <MoodWeatherCard analysis={moodWeather} />
      <WeatherCard weather={weather} />

      <View style={styles.rangeTabs}>
        {RANGE_OPTIONS.map((option) => (
          <Pressable
            key={option.key}
            style={[styles.rangeTab, rangeKey === option.key && styles.rangeTabActive]}
            onPress={() => {
              setRangeKey(option.key);
              setSelectedDay(null);
            }}
          >
            <Text style={[styles.rangeText, rangeKey === option.key && styles.rangeTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.statsGrid}>
        {MOODS.map((mood) => (
          <View key={mood.emoji} style={styles.statCard}>
            <Text style={styles.statEmoji}>{mood.emoji}</Text>
            <Text style={styles.statCount}>{filteredRecords.filter((item) => item.emoji === mood.emoji).length}</Text>
            <Text style={styles.statLabel}>{mood.detail}</Text>
          </View>
        ))}
      </View>

      <View style={styles.heatmapPanel}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.calendarScroller}>
          <View>
            <View style={styles.monthRow}>
              <View style={styles.monthSpacer} />
              {monthLabels.map((label, index) => (
                <Text key={`${label}-${index}`} style={styles.monthText}>{label}</Text>
              ))}
            </View>
            <View style={styles.calendarRow}>
              <View style={styles.weekdayLabels}>
                {['一', '二', '三', '四', '五', '六', '日'].map((label) => (
                  <Text key={label} style={styles.weekdayText}>{label}</Text>
                ))}
              </View>
              <View style={styles.weeks}>
                {weeks.map((week, weekIndex) => (
                  <View key={weekIndex} style={styles.week}>
                    {week.map((day) => {
                      const key = dayKey(day);
                      const dayRecords = dayMap[key] || [];
                      const record = latestRecord(dayRecords);
                      const mood = MOODS.find((item) => item.emoji === record?.emoji);
                      const selected = selectedDay === key;
                      const isToday = key === dayKey(new Date());
                      return (
                        <Pressable
                          key={key}
                          accessibilityLabel={record ? `${key} ${record.emoji}` : `${key} 未记录`}
                          style={[
                            styles.dayCell,
                            { backgroundColor: mood?.color || '#f4e8f0' },
                            isToday && styles.dayCellToday,
                            selected && styles.dayCellSelected,
                          ]}
                          onPress={() => setSelectedDay(key)}
                        >
                          {dayRecords.length > 1 ? (
                            <Text style={styles.dayCount}>{dayRecords.length}</Text>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>
      </View>

      <Text style={styles.detailBox}>{detail}</Text>
      <RecentTimeline records={recentRecords} />
      <QuickCaptureRail onCapture={onCapture} />
    </ScrollView>
  );
}

function RecentTimeline({ records }) {
  return (
    <View style={styles.timelinePanel}>
      <Text style={styles.quickTitle}>最近记录</Text>
      {records.length ? records.map((record) => (
        <View key={record.id} style={styles.timelineItem}>
          <Text style={styles.timelineEmoji}>{record.emoji}</Text>
          <Text style={styles.timelineText}>{formatRecordTime(record.timestamp)}</Text>
        </View>
      )) : (
        <Text style={styles.shortcutText}>还没有记录，先去按一个心情。</Text>
      )}
    </View>
  );
}

function MoodWeatherCard({ analysis }) {
  return (
    <View style={[styles.weatherCard, styles[`weatherCard_${analysis.level}`]]}>
      <View style={styles.weatherHeader}>
        <Text style={styles.weatherEmoji}>{analysis.emoji}</Text>
        <View style={styles.weatherCopy}>
          <Text style={styles.weatherKicker}>情绪天气</Text>
          <Text style={styles.weatherTitle}>{analysis.title}</Text>
        </View>
      </View>
      <Text style={styles.weatherReason}>{analysis.reason}</Text>
      <View style={styles.tipBox}>
        <Text style={styles.tipText}>{analysis.tip}</Text>
      </View>
    </View>
  );
}

function WeatherCard({ weather }) {
  const content = formatWeatherCard(weather);

  return (
    <View style={styles.localWeatherCard}>
      <View style={styles.weatherHeader}>
        <Text style={styles.weatherEmoji}>{content.emoji}</Text>
        <View style={styles.weatherCopy}>
          <Text style={styles.weatherKicker}>当地天气</Text>
          <Text style={styles.weatherTitle}>{content.title}</Text>
        </View>
      </View>
      <Text style={styles.weatherReason}>{content.detail}</Text>
    </View>
  );
}

function QuickCaptureRail({ onCapture }) {
  return (
    <View style={styles.quickRail}>
      <Text style={styles.quickTitle}>快捷记录</Text>
      <View style={styles.quickButtons}>
        {MOODS.map((mood) => (
          <Pressable
            key={mood.emoji}
            style={({ pressed }) => [
              styles.quickButton,
              { borderColor: mood.color },
              pressed && styles.quickButtonPressed,
            ]}
            onPress={(event) => {
              const { pageX, pageY } = event.nativeEvent;
              onCapture(mood, pageX || SCREEN_WIDTH / 2, pageY || 620);
            }}
          >
            <Text style={styles.quickEmoji}>{mood.emoji}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function SettingsScreen({
  reminderEnabled,
  reminderTimes,
  reminderMessage,
  settingsToast,
  setReminderTimes,
  setReminderMessage,
  onToggleNotifications,
  session,
  syncEmail,
  syncToast,
  setSyncEmail,
  onSendLoginLink,
  onSignOut,
  onSyncNow,
}) {
  return (
    <ScrollView style={styles.canvas} contentContainerStyle={styles.canvasContent}>
      <View style={styles.canvasHeader}>
        <View>
          <Text style={styles.kicker}>偏好</Text>
          <Text style={styles.canvasTitle}>设置</Text>
        </View>
      </View>

      <ReminderPanel
        reminderEnabled={reminderEnabled}
        reminderTimes={reminderTimes}
        reminderMessage={reminderMessage}
        setReminderTimes={setReminderTimes}
        setReminderMessage={setReminderMessage}
        onToggleNotifications={onToggleNotifications}
      />
      {settingsToast ? <Text style={styles.detailBox}>{settingsToast}</Text> : null}
      <SupabasePanel
        session={session}
        syncEmail={syncEmail}
        syncToast={syncToast}
        setSyncEmail={setSyncEmail}
        onSendLoginLink={onSendLoginLink}
        onSignOut={onSignOut}
        onSyncNow={onSyncNow}
      />
      <ShortcutPanel />
    </ScrollView>
  );
}

function SupabasePanel({
  session,
  syncEmail,
  syncToast,
  setSyncEmail,
  onSendLoginLink,
  onSignOut,
  onSyncNow,
}) {
  return (
    <View style={styles.reminderPanel}>
      <View style={styles.panelHeader}>
        <View>
          <Text style={styles.panelKicker}>SYNC</Text>
          <Text style={styles.panelTitle}>Supabase cloud sync</Text>
        </View>
        <Pressable style={({ pressed }) => [styles.panelAction, pressed && styles.quickButtonPressed]} onPress={onSyncNow}>
          <Text style={styles.panelActionText}>Sync</Text>
        </Pressable>
      </View>

      <Text style={styles.syncStatus}>{syncToast}</Text>
      {session ? (
        <View style={styles.syncActions}>
          <Text style={styles.shortcutText}>Signed in as {session.user.email || 'Supabase user'}</Text>
          <Pressable style={({ pressed }) => [styles.ghostAction, pressed && styles.quickButtonPressed]} onPress={onSignOut}>
            <Text style={styles.ghostActionText}>Sign out</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.messageEditor}>
            <Text style={styles.timeLabel}>Email</Text>
            <TextInput
              style={styles.messageInput}
              value={syncEmail}
              onChangeText={setSyncEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor="#b28da0"
            />
          </View>
          <Pressable style={({ pressed }) => [styles.panelAction, pressed && styles.quickButtonPressed]} onPress={onSendLoginLink}>
            <Text style={styles.panelActionText}>Send login link</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function ReminderPanel({
  reminderEnabled,
  reminderTimes,
  reminderMessage,
  setReminderTimes,
  setReminderMessage,
  onToggleNotifications,
}) {
  return (
    <View style={styles.reminderPanel}>
      <View style={styles.panelHeader}>
        <View>
          <Text style={styles.panelKicker}>提醒</Text>
          <Text style={styles.panelTitle}>自定义打卡时间</Text>
        </View>
        <Switch
          value={reminderEnabled}
          onValueChange={onToggleNotifications}
          trackColor={{ false: '#efd7e2', true: '#a7e8c9' }}
          thumbColor="#ffffff"
        />
      </View>

      {reminderEnabled ? (
        <>
          {reminderTimes.map((time, index) => (
            <TimeStepper
              key={time.id}
              label={`提醒 ${index + 1}`}
              time={time}
              onChange={(nextTime) => {
                setReminderTimes((current) =>
                  current.map((item) => (item.id === time.id ? { ...item, ...nextTime } : item))
                );
              }}
            />
          ))}

          <View style={styles.messageEditor}>
            <Text style={styles.timeLabel}>提示语</Text>
            <TextInput
              style={styles.messageInput}
              value={reminderMessage}
              onChangeText={setReminderMessage}
              placeholder="写一句提醒自己的话"
              placeholderTextColor="#b28da0"
              multiline
            />
          </View>
        </>
      ) : (
        <Text style={styles.reminderHint}>打开提醒后，可以设置时间和提示语。</Text>
      )}
    </View>
  );
}

function TimeStepper({ label, time, onChange }) {
  return (
    <View style={styles.timeRow}>
      <Text style={styles.timeLabel}>{label}</Text>
      <View style={styles.timeControls}>
        <StepButton label="-" onPress={() => onChange({ hour: wrap(time.hour - 1, 24) })} />
        <Text style={styles.timeValue}>{formatTwoDigits(time.hour)}</Text>
        <StepButton label="+" onPress={() => onChange({ hour: wrap(time.hour + 1, 24) })} />
        <Text style={styles.timeColon}>:</Text>
        <StepButton label="-" onPress={() => onChange({ minute: wrap(time.minute - 5, 60) })} />
        <Text style={styles.timeValue}>{formatTwoDigits(time.minute)}</Text>
        <StepButton label="+" onPress={() => onChange({ minute: wrap(time.minute + 5, 60) })} />
      </View>
    </View>
  );
}

function StepButton({ label, onPress }) {
  return (
    <Pressable style={({ pressed }) => [styles.stepButton, pressed && styles.stepButtonPressed]} onPress={onPress}>
      <Text style={styles.stepButtonText}>{label}</Text>
    </Pressable>
  );
}

function ShortcutPanel() {
  return (
    <View style={styles.shortcutPanel}>
      <Text style={styles.quickTitle}>快捷指令接口</Text>
      <Text style={styles.shortcutText}>在快捷指令里使用“打开 URL”，填入下面任意一个地址。</Text>
      {MOODS.map((mood) => (
        <Text key={mood.key} style={styles.shortcutUrl}>
          emomo://mood/{mood.key}
        </Text>
      ))}
    </View>
  );
}

async function prepareRecords() {
  await clearRecordsOnce();
  return loadRecords();
}

async function clearRecordsOnce() {
  try {
    const marker = await FileSystem.getInfoAsync(RESET_MARKER_FILE);
    if (marker.exists) return;

    const recordFile = await FileSystem.getInfoAsync(RECORD_FILE);
    if (recordFile.exists) {
      await FileSystem.deleteAsync(RECORD_FILE, { idempotent: true });
    }
    await FileSystem.writeAsStringAsync(RESET_MARKER_FILE, JSON.stringify({ resetAt: Date.now() }));
  } catch {
    // A reset failure should not block the app from opening.
  }
}

async function loadRecords() {
  try {
    const info = await FileSystem.getInfoAsync(RECORD_FILE);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(RECORD_FILE);
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveRecords(records) {
  await FileSystem.writeAsStringAsync(RECORD_FILE, JSON.stringify(records, null, 2));
}

async function syncRecordsWithCloud(localRecords, session) {
  if (!supabase || !session) {
    return { ok: false, message: 'Supabase is not configured or signed in.', records: localRecords };
  }

  const userId = session.user.id;
  const rows = localRecords.map((record) => ({
    id: String(record.id),
    user_id: userId,
    timestamp: record.timestamp,
    emoji: record.emoji,
    tag: record.tag || '',
    weather: record.weather || null,
  }));

  if (rows.length) {
    const { error } = await supabase.from('mood_records').upsert(rows, { onConflict: 'id' });
    if (error) return { ok: false, message: `Upload failed: ${error.message}`, records: localRecords };
  }

  const { data, error } = await supabase
    .from('mood_records')
    .select('id,timestamp,emoji,tag,weather')
    .order('timestamp', { ascending: true });

  if (error) return { ok: false, message: `Download failed: ${error.message}`, records: localRecords };

  const records = mergeRecords(localRecords, data || []);
  return { ok: true, message: `Synced ${records.length} records.`, records };
}

async function pushRecordToCloud(record, session) {
  if (!supabase || !session) return;

  const { error } = await supabase.from('mood_records').upsert(
    {
      id: String(record.id),
      user_id: session.user.id,
      timestamp: record.timestamp,
      emoji: record.emoji,
      tag: record.tag || '',
      weather: record.weather || null,
    },
    { onConflict: 'id' }
  );

  if (error) {
    console.warn('Supabase record upload failed:', error.message);
  }
}

function mergeRecords(localRecords, remoteRecords) {
  const map = new Map();
  [...localRecords, ...remoteRecords].forEach((record) => {
    map.set(String(record.id), {
      id: String(record.id),
      timestamp: Number(record.timestamp),
      emoji: record.emoji,
      tag: record.tag || '',
      weather: record.weather || null,
    });
  });
  return [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
}

async function completeSupabaseUrl(url) {
  if (!supabase || !url) return null;

  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      return data.session;
    }

    const hash = parsed.hash?.replace(/^#/, '');
    const hashParams = new URLSearchParams(hash);
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    if (accessToken && refreshToken) {
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
      return data.session;
    }
  } catch (error) {
    console.warn('Supabase auth URL handling failed:', error.message);
  }

  return null;
}

async function loadLocalWeather() {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      return { status: 'blocked' };
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const { latitude, longitude } = position.coords;
    const url = [
      'https://api.open-meteo.com/v1/forecast',
      `?latitude=${latitude}`,
      `&longitude=${longitude}`,
      '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
      '&timezone=auto',
    ].join('');
    const response = await fetch(url);
    if (!response.ok) throw new Error('weather request failed');
    const payload = await response.json();
    const current = payload.current;
    const condition = weatherConditionFromCode(current.weather_code);

    return {
      status: 'ready',
      data: {
        temperature: Math.round(current.temperature_2m),
        humidity: Math.round(current.relative_humidity_2m),
        windSpeed: Math.round(current.wind_speed_10m),
        code: current.weather_code,
        condition: condition.label,
        emoji: condition.emoji,
        observedAt: Date.now(),
      },
    };
  } catch {
    return { status: 'error' };
  }
}

async function scheduleMoodNotifications(reminderTimes, reminderMessage) {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('emomo', {
      name: 'emomo',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180],
      lightColor: '#ffd447',
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }

  if (status !== 'granted') {
    Alert.alert('通知未开启', '请在系统设置中允许 emomo 发送通知。');
    return '通知权限未开启';
  }

  await Notifications.cancelAllScheduledNotificationsAsync();
  await Promise.all(reminderTimes.map((time) => scheduleDaily(time.hour, time.minute, reminderMessage)));
  return `已开启 ${reminderTimes.map(formatReminderTime).join(' 和 ')} 本地提醒`;
}

async function cancelMoodNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
  return '已关闭本地提醒';
}

async function scheduleDaily(hour, minute, reminderMessage) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'emomo',
      body: reminderMessage.trim() || DEFAULT_REMINDER_MESSAGE,
      sound: false,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: Platform.OS === 'android' ? 'emomo' : undefined,
    },
  });
}

function groupRecordsByDay(records) {
  return records.reduce((map, record) => {
    const key = dayKey(new Date(record.timestamp));
    map[key] = [...(map[key] || []), record];
    return map;
  }, {});
}

function latestRecord(records = []) {
  return records.reduce((latest, record) => {
    if (!latest || record.timestamp > latest.timestamp) return record;
    return latest;
  }, null);
}

function sortRecords(records = []) {
  return [...records].sort((a, b) => a.timestamp - b.timestamp);
}

function analyzeMood(records) {
  const sorted = sortRecords(records);
  if (!sorted.length) {
    return {
      level: 'empty',
      emoji: '🌱',
      title: '等第一颗情绪种子',
      reason: '有记录之后，emomo 会观察最近的情绪节奏。',
      tip: '先轻轻按一个此刻的心情。',
    };
  }

  const recent = sorted.slice(-5);
  const lastThree = sorted.slice(-3);
  const weekRecords = filterRecordsByRange(sorted, 7);
  const todayRecords = sorted.filter((record) => dayKey(new Date(record.timestamp)) === dayKey(new Date()));
  const lowRecentCount = recent.filter((record) => scoreRecord(record) <= -2).length;
  const lowLastThreeCount = lastThree.filter((record) => scoreRecord(record) <= -2).length;
  const lowTodayCount = todayRecords.filter((record) => scoreRecord(record) <= -2).length;
  const weekAverage = averageScore(weekRecords);
  const quietDays = daysSince(sorted[sorted.length - 1].timestamp);

  if (lowLastThreeCount >= 3) {
    return makeAnalysis('care', '最近有点低电量', '最近 3 次记录都偏低，值得温柔地关注一下。', sorted.length);
  }

  if (lowRecentCount >= 4 || weekAverage <= -1.4) {
    return makeAnalysis('care', '这段时间有点重', '最近的低落信号出现得比较密集。', sorted.length);
  }

  if (lowTodayCount >= 3) {
    return makeAnalysis('watch', '今天波动有点多', '今天偏低的记录出现了几次。', sorted.length);
  }

  if (weekAverage <= -0.7 || lowRecentCount >= 2) {
    return makeAnalysis('watch', '最近有点多云', '最近几次记录里，低电量情绪出现得稍多。', sorted.length);
  }

  if (quietDays >= 3) {
    return {
      level: 'empty',
      emoji: '🌙',
      title: '有几天没记录了',
      reason: '暂时没有足够的新记录可以判断。',
      tip: '现在按一下就好。',
    };
  }

  return makeAnalysis('ok', '今天还算轻', '最近记录整体比较平稳。', sorted.length);
}

function makeAnalysis(level, title, reason, seed) {
  const weather = {
    ok: { emoji: '☁️' },
    watch: { emoji: '🌦️' },
    care: { emoji: '🌧️' },
  };
  return {
    level,
    emoji: weather[level].emoji,
    title,
    reason,
    tip: pickRegulationTip(level, seed),
  };
}

function scoreRecord(record) {
  const mood = MOODS.find((item) => item.emoji === record.emoji);
  const scores = {
    happy: 2,
    calm: 1,
    tired: -1,
    down: -2,
    sad: -2,
    angry: -2,
  };
  return scores[mood?.key] || 0;
}

function averageScore(records) {
  if (!records.length) return 0;
  return records.reduce((total, record) => total + scoreRecord(record), 0) / records.length;
}

function pickRegulationTip(level, seed) {
  const tips = REGULATION_TIPS[level] || REGULATION_TIPS.ok;
  return tips[seed % tips.length];
}

function daysSince(timestamp) {
  const then = startOfDay(new Date(timestamp));
  const now = startOfDay(new Date());
  return Math.floor((now.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
}

function filterRecordsByRange(records, days) {
  const end = new Date();
  const start = startOfDay(end);
  start.setDate(start.getDate() - days + 1);
  return records.filter((record) => record.timestamp >= start.getTime());
}

function buildCalendarWeeks(daysBack) {
  const today = startOfDay(new Date());
  const start = new Date(today);
  start.setDate(today.getDate() - daysBack + 1);
  while (start.getDay() !== 1) {
    start.setDate(start.getDate() - 1);
  }

  const weeks = [];
  const weekCount = Math.ceil((today.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  for (let week = 0; week < weekCount; week += 1) {
    const days = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + week * 7 + day);
      days.push(date);
    }
    weeks.push(days);
  }
  return weeks;
}

function buildMonthLabels(weeks) {
  return weeks.map((week, index) => {
    const firstDay = week[0];
    const containsMonthStart = week.some((day) => day.getDate() <= 7);
    if (index === 0 || containsMonthStart) {
      return `${firstDay.getMonth() + 1}月`;
    }
    return '';
  });
}

function dayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatRangeText(daysBack) {
  const end = startOfDay(new Date());
  const start = new Date(end);
  start.setDate(end.getDate() - daysBack + 1);
  return `${formatDateShort(start)} - ${formatDateShort(end)}`;
}

function formatDateShort(date) {
  return date.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  });
}

function formatDayTitle(day) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

function formatRecordTime(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRecordClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function moodFromShortcutUrl(url) {
  const normalized = decodeURIComponent(String(url || '')).toLowerCase();
  const directMatch = normalized.match(/^emomo:\/\/mood\/([^/?#]+)/);
  const queryMatch = normalized.match(/[?&]mood=([^&#]+)/);
  const key = directMatch?.[1] || queryMatch?.[1];
  if (!key) return null;
  return MOODS.find((mood) => mood.key === key || mood.label.toLowerCase() === key) || null;
}

function formatWeatherCard(weather) {
  if (!weather) {
    return {
      emoji: '⛅',
      title: '天气读取中',
      detail: '拿到位置权限后，会把当时天气一起写进记录。',
    };
  }

  if (weather.status === 'blocked') {
    return {
      emoji: '🌤️',
      title: '天气未开启',
      detail: '允许位置权限后，emomo 可以记录当地天气。',
    };
  }

  if (weather.status !== 'ready') {
    return {
      emoji: '☁️',
      title: '天气暂时不可用',
      detail: '打卡不会受影响，稍后会自动再试。',
    };
  }

  const data = weather.data;
  return {
    emoji: data.emoji,
    title: `${data.temperature}°C · ${data.condition}`,
    detail: `湿度 ${data.humidity}% · 风速 ${data.windSpeed} km/h。打卡时会保存这份天气。`,
  };
}

function formatRecordWeather(weather) {
  if (!weather) return '未记录天气';
  return `${weather.emoji || '⛅'} ${weather.temperature}°C · ${weather.condition || '天气'}`;
}

function weatherConditionFromCode(code) {
  if (code === 0) return { label: '晴', emoji: '☀️' };
  if ([1, 2].includes(code)) return { label: '少云', emoji: '🌤️' };
  if (code === 3) return { label: '多云', emoji: '☁️' };
  if ([45, 48].includes(code)) return { label: '雾', emoji: '🌫️' };
  if ([51, 53, 55, 56, 57].includes(code)) return { label: '毛毛雨', emoji: '🌦️' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: '雨', emoji: '🌧️' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: '雪', emoji: '❄️' };
  if ([95, 96, 99].includes(code)) return { label: '雷雨', emoji: '⛈️' };
  return { label: '天气', emoji: '⛅' };
}

function formatReminderTime(time) {
  return `${formatTwoDigits(time.hour)}:${formatTwoDigits(time.minute)}`;
}

function formatTwoDigits(value) {
  return String(value).padStart(2, '0');
}

function wrap(value, max) {
  return ((value % max) + max) % max;
}

function seeded(seed) {
  const value = Math.sin(seed * 999) * 10000;
  return value - Math.floor(value);
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#fff7fb',
  },
  app: {
    flex: 1,
    backgroundColor: '#fff7fb',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 10,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff8fb3',
  },
  brandMarkText: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 12,
  },
  brandText: {
    color: '#43323d',
    fontSize: 17,
    fontWeight: '800',
  },
  tabs: {
    width: 188,
    padding: 4,
    borderRadius: 14,
    flexDirection: 'row',
    backgroundColor: '#fffefe',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  tab: {
    flex: 1,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: '#ff8fb3',
  },
  tabText: {
    color: '#9b7f8f',
    fontSize: 13,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  capture: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    gap: 22,
  },
  timeChip: {
    color: '#9b7f8f',
    fontSize: 13,
    fontWeight: '700',
  },
  title: {
    color: '#43323d',
    fontSize: 42,
    lineHeight: 46,
    fontWeight: '900',
    textAlign: 'center',
  },
  moodGrid: {
    width: '100%',
    maxWidth: 390,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  moodButton: {
    width: '48.5%',
    height: 136,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffefe',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  moodButtonWide: {
    width: '100%',
    height: 112,
  },
  moodButtonPressed: {
    transform: [{ scale: 0.96 }],
    backgroundColor: '#fff0f7',
  },
  moodEmoji: {
    fontSize: 58,
    lineHeight: 68,
  },
  moodLabel: {
    color: '#9b7f8f',
    fontSize: 13,
    fontWeight: '800',
  },
  savedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,247,251,0.84)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedEmoji: {
    fontSize: 126,
    lineHeight: 140,
  },
  savedText: {
    color: '#9b7f8f',
    fontSize: 17,
    fontWeight: '800',
  },
  particle: {
    position: 'absolute',
    borderRadius: 99,
  },
  canvas: {
    flex: 1,
  },
  canvasContent: {
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 32,
    gap: 20,
  },
  canvasHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  kicker: {
    color: '#ff8fb3',
    fontSize: 12,
    fontWeight: '800',
  },
  canvasTitle: {
    color: '#43323d',
    fontSize: 35,
    fontWeight: '900',
  },
  rangeSummary: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff0f7',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  rangeSummaryText: {
    color: '#9b7f8f',
    fontSize: 13,
    fontWeight: '800',
  },
  weatherCard: {
    gap: 12,
    padding: 14,
    borderRadius: 20,
    backgroundColor: '#fffefe',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  weatherCard_empty: {
    backgroundColor: '#fffefe',
  },
  weatherCard_ok: {
    backgroundColor: '#f4fff9',
    borderColor: '#c8efd9',
  },
  weatherCard_watch: {
    backgroundColor: '#fffdf2',
    borderColor: '#f3df9e',
  },
  weatherCard_care: {
    backgroundColor: '#fff2f7',
    borderColor: '#f3bed3',
  },
  localWeatherCard: {
    gap: 10,
    padding: 14,
    borderRadius: 20,
    backgroundColor: '#f5fbff',
    borderWidth: 1,
    borderColor: '#cfe8f4',
  },
  weatherHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  weatherEmoji: {
    width: 48,
    height: 48,
    borderRadius: 16,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 30,
    backgroundColor: 'rgba(255,255,255,0.65)',
    overflow: 'hidden',
  },
  weatherCopy: {
    flex: 1,
  },
  weatherKicker: {
    color: '#ff8fb3',
    fontSize: 11,
    fontWeight: '900',
  },
  weatherTitle: {
    color: '#43323d',
    fontSize: 20,
    fontWeight: '900',
    marginTop: 2,
  },
  weatherReason: {
    color: '#6e5a66',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  tipBox: {
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.66)',
  },
  tipLabel: {
    color: '#b28da0',
    fontSize: 10,
    fontWeight: '900',
  },
  tipText: {
    color: '#43323d',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  alarmButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffefe',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  alarmIcon: {
    fontSize: 22,
  },
  reminderPanel: {
    gap: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#fffefe',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  panelKicker: {
    color: '#ff8fb3',
    fontSize: 11,
    fontWeight: '800',
  },
  panelTitle: {
    color: '#43323d',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },
  panelAction: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff8fb3',
  },
  panelActionText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  ghostAction: {
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff0f7',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  ghostActionText: {
    color: '#9b7f8f',
    fontSize: 13,
    fontWeight: '900',
  },
  syncStatus: {
    color: '#6e5a66',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#fff0f7',
  },
  syncActions: {
    gap: 10,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  timeLabel: {
    width: 58,
    color: '#9b7f8f',
    fontSize: 12,
    fontWeight: '800',
  },
  timeControls: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  stepButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffefe',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  stepButtonPressed: {
    backgroundColor: '#fff0f7',
  },
  stepButtonText: {
    color: '#43323d',
    fontSize: 17,
    lineHeight: 20,
    fontWeight: '900',
  },
  timeValue: {
    width: 28,
    color: '#43323d',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  timeColon: {
    color: '#9b7f8f',
    fontSize: 15,
    fontWeight: '900',
  },
  reminderHint: {
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    overflow: 'hidden',
    color: '#9b7f8f',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    backgroundColor: '#fff7fb',
  },
  messageEditor: {
    gap: 8,
  },
  messageInput: {
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    color: '#43323d',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textAlignVertical: 'top',
    backgroundColor: '#fffefe',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  rangeTabs: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 16,
    backgroundColor: '#fffefe',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  rangeTab: {
    flex: 1,
    height: 34,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeTabActive: {
    backgroundColor: '#ff8fb3',
  },
  rangeText: {
    color: '#9b7f8f',
    fontSize: 12,
    fontWeight: '800',
  },
  rangeTextActive: {
    color: '#ffffff',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statCard: {
    width: '48.7%',
    minHeight: 98,
    borderRadius: 18,
    padding: 12,
    backgroundColor: '#fffefe',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  statEmoji: {
    fontSize: 22,
  },
  statCount: {
    color: '#43323d',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 4,
  },
  statLabel: {
    color: '#9b7f8f',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  calendarScroller: {
    marginHorizontal: -2,
  },
  heatmapPanel: {
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#fffefe',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  monthSpacer: {
    width: 30,
  },
  monthText: {
    width: 21,
    height: 16,
    color: '#b28da0',
    fontSize: 9,
    fontWeight: '800',
  },
  calendarRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 2,
  },
  weekdayLabels: {
    gap: 5,
  },
  weekdayText: {
    width: 22,
    height: 16,
    color: '#b28da0',
    fontSize: 10,
    fontWeight: '800',
  },
  weeks: {
    flexDirection: 'row',
    gap: 5,
  },
  week: {
    gap: 5,
  },
  dayCell: {
    width: 16,
    height: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellSelected: {
    borderColor: '#ff6fa8',
    borderWidth: 2,
  },
  dayCellToday: {
    borderColor: '#74d6b6',
    borderWidth: 2,
  },
  dayCount: {
    color: '#43323d',
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '900',
  },
  detailBox: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    overflow: 'hidden',
    color: '#6e5a66',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
    backgroundColor: '#fffefe',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  quickRail: {
    gap: 10,
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#fffefe',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  quickTitle: {
    color: '#ff8fb3',
    fontSize: 12,
    fontWeight: '800',
  },
  quickButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  quickButton: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff7fb',
    borderWidth: 1,
  },
  quickButtonPressed: {
    transform: [{ scale: 0.94 }],
    backgroundColor: '#fff0f7',
  },
  quickEmoji: {
    fontSize: 24,
    lineHeight: 30,
  },
  timelinePanel: {
    gap: 10,
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#fffefe',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  timelineItem: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#fff7fb',
  },
  timelineEmoji: {
    fontSize: 22,
  },
  timelineText: {
    color: '#6e5a66',
    fontSize: 13,
    fontWeight: '800',
  },
  shortcutPanel: {
    gap: 8,
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#fffefe',
    borderWidth: 1,
    borderColor: '#f4cfe0',
  },
  shortcutText: {
    color: '#9b7f8f',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  shortcutUrl: {
    minHeight: 28,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
    color: '#43323d',
    fontSize: 12,
    fontWeight: '800',
    backgroundColor: '#fff7fb',
  },
});
