import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import EmergencyButton from './components/EmergencyButton';
import ManeuverIcon from './components/ManeuverIcon';
import PlaceField from './components/PlaceField';
import SettingsModal from './components/SettingsModal';
import { describeLocation, Place } from './lib/geocode';
import { SavedPlace, useStore } from './lib/store';
import { LatLng, metresBetween } from './lib/geo';
import {
  Departure,
  arrivalTime,
  departureDate,
  departureHour,
  formatClock,
  formatDistance,
  formatMiles,
  isAfterDark,
  routeMinutes,
} from './lib/format';
import { HAVEN_KINDS, Region, havensInRegion, havensNearRoute, nearestHaven } from './lib/havens';
import { Plan, comparisonNote, optimizedIndex, planWalk, plottableCrimes, rankOptions } from './lib/plan';
import {
  Theme,
  darkTheme,
  lightTheme,
  mapStyleDark,
  mapStyleLight,
  mono,
  radius,
  riskColours,
} from './theme';

const NYC: Region = {
  latitude: 40.7484,
  longitude: -73.9857,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

type Mode = 'plan' | 'results' | 'navigating';

/** Home first, then Work, then everything else in the order it was added. */
const rank = (name: string) => (/^home$/i.test(name) ? 0 : /^work$/i.test(name) ? 1 : 2);

/** Call just before a state change to have the layout glide to its new shape. */
const animate = () =>
  LayoutAnimation.configureNext(LayoutAnimation.create(240, 'easeInEaseOut', 'opacity'));

const toLatLng = (coords: [number, number][]) =>
  coords.map(([latitude, longitude]) => ({ latitude, longitude }));

export default function Main() {
  const { settings, places, update } = useStore();
  const systemScheme = useColorScheme();
  const dark = settings.appearance === 'system' ? systemScheme === 'dark' : settings.appearance === 'dark';
  const t = dark ? darkTheme : lightTheme;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const followRef = useRef(settings.followWhileWalking);
  followRef.current = settings.followWhileWalking;

  const haptic = useCallback(
    (kind: 'Success' | 'Error' | 'Medium' | 'Select') => {
      if (!settings.haptics) return;
      const run =
        kind === 'Success'
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          : kind === 'Error'
            ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
            : kind === 'Medium'
              ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
              : Haptics.selectionAsync();
      run.catch(() => {});
    },
    [settings.haptics],
  );
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);

  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [start, setStart] = useState<LatLng | null>(null);
  const [end, setEnd] = useState<LatLng | null>(null);
  const [departure, setDeparture] = useState<Departure>(settings.defaultDeparture);
  const [customDate, setCustomDate] = useState(new Date());
  const [pickingTime, setPickingTime] = useState(false);

  const [plan, setPlan] = useState<Plan | null>(null);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('plan');
  // The search card folds into a one-line bar once routes are found, and the
  // bottom sheet starts as just the route options, so the map stays visible.
  const [topOpen, setTopOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [position, setPosition] = useState<LatLng | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [region, setRegion] = useState<Region>(NYC);
  const showHavens = settings.showHavens;
  const watcher = useRef<Location.LocationSubscription | null>(null);

  const candidate = plan?.candidates[selected] ?? null;
  const hour = departureHour(departure);

  const crimesShown = useMemo(
    () => (settings.showIncidents && plan && candidate ? plottableCrimes(plan.crimes, candidate.coords) : []),
    [plan, candidate, settings.showIncidents],
  );
  const havens = useMemo(() => {
    if (!showHavens) return [];
    return candidate && mode !== 'plan'
      ? havensNearRoute(candidate.coords)
      : havensInRegion(region);
  }, [showHavens, candidate, mode, region]);

  const stopWatching = useCallback(() => {
    watcher.current?.remove();
    watcher.current = null;
  }, []);
  useEffect(() => stopWatching, [stopWatching]);

  const requestPermission = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Location is off',
        'SafeWalk NYC needs your location to start from where you are and to guide you. You can turn it on in Settings.',
        [{ text: 'Not now' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }],
      );
      return false;
    }
    return true;
  }, []);

  const useMyLocation = useCallback(async () => {
    if (!(await requestPermission())) return;
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = fix.coords;
      setStart({ latitude, longitude });
      setStartText('My location');
      setPlan(null);
      map.current?.animateToRegion(
        { latitude, longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 },
        400,
      );
      describeLocation(latitude, longitude)
        .then((name) => setStartText((cur) => (cur === 'My location' ? name : cur)))
        .catch(() => {});
    } catch {
      setError('Could not get your location. Try again outside or type an address.');
    }
  }, [requestPermission]);

  const fit = useCallback((coords: [number, number][]) => {
    map.current?.fitToCoordinates(toLatLng(coords), {
      edgePadding: { top: 150, right: 50, bottom: 320, left: 50 },
      animated: true,
    });
  }, []);

  const findRoutes = async () => {
    if (!start || !end) {
      setError('Choose a start and a destination from the suggestions.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await planWalk(start, end, hour);
      setPlan(result);
      setSelected(result.dataAvailable ? optimizedIndex(result.candidates) : 0);
      animate();
      setMode('results');
      setTopOpen(false);
      setSheetOpen(false);
      haptic('Success');
      fit(result.candidates.flatMap((c) => c.coords));
    } catch (e: any) {
      setError(e?.message || 'Could not plan that walk.');
      haptic('Error');
    } finally {
      setLoading(false);
    }
  };

  const edit = useCallback(() => {
    animate();
    setTopOpen(true);
    stopWatching();
    setMode('plan');
    setPlan(null);
  }, [stopWatching]);

  const startNavigation = async () => {
    if (!candidate || !(await requestPermission())) return;
    setStepIndex(0);
    animate();
    setSheetOpen(false);
    setMode('navigating');
    haptic('Medium');
    stopWatching();
    watcher.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5 },
      (fix) => {
        const here = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
        setPosition(here);
        if (followRef.current) {
          map.current?.animateCamera({ center: here, zoom: 18 }, { duration: 500 });
        }
      },
    );
  };

  const steps = candidate?.route.steps ?? [];

  // Move on to whichever manoeuvre we are closest to, never going backwards.
  useEffect(() => {
    if (mode !== 'navigating' || !position || !steps.length) return;
    let best = stepIndex;
    let bestD = Infinity;
    steps.forEach((s, i) => {
      if (i < stepIndex || !s.at) return;
      const d = metresBetween(position.latitude, position.longitude, s.at[0], s.at[1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    // Within 25 m of a manoeuvre means we are on to the one after it.
    const next = bestD < 25 ? Math.min(best + 1, steps.length - 1) : best;
    if (next !== stepIndex) {
      setStepIndex(next);
      haptic('Select');
    }
  }, [position, mode, steps, stepIndex, haptic]);

  const remaining = useMemo(() => {
    if (mode !== 'navigating' || !position || !candidate) return null;
    const last = candidate.coords[candidate.coords.length - 1];
    return metresBetween(position.latitude, position.longitude, last[0], last[1]);
  }, [mode, position, candidate]);

  useEffect(() => {
    if (mode === 'navigating' && remaining !== null && remaining < 20) {
      stopWatching();
      haptic('Success');
      Alert.alert('You have arrived', endText, [{ text: 'Done', onPress: edit }]);
    }
  }, [remaining, mode, stopWatching, edit, endText]);

  const walkMessage = () => {
    if (!candidate) return '';
    const minutes = routeMinutes(candidate.route);
    const eta = arrivalTime(departure, minutes);
    const here = position ?? start;
    const where = here
      ? `\nMy location: https://maps.apple.com/?ll=${here.latitude},${here.longitude}`
      : '';
    return `I'm walking to ${endText}. Expected arrival ${eta} (${minutes} min, ${formatMiles(candidate.route.distance)}).${where}`;
  };

  const shareWalk = async () => {
    if (!candidate) return;
    try {
      await Share.share({ message: walkMessage() });
    } catch {
      // Dismissing the share sheet is not an error worth showing.
    }
  };

  const textContact = () => {
    const phone = settings.contactPhone.replace(/[^\d+]/g, '');
    if (!phone) return;
    const sep = Platform.OS === 'ios' ? '&' : '?';
    Linking.openURL(`sms:${phone}${sep}body=${encodeURIComponent(walkMessage())}`);
  };

  const callContact = () => {
    const phone = settings.contactPhone.replace(/[^\d+]/g, '');
    if (phone) Linking.openURL(`tel:${phone}`);
  };

  /** Tap sets the destination; press and hold starts from there instead. */
  const usePlace = (place: SavedPlace, asStart: boolean) => {
    const point = { latitude: place.latitude, longitude: place.longitude };
    const text = place.name;
    haptic('Select');
    setPlan(null);
    setMode('plan');
    if (asStart) {
      setStart(point);
      setStartText(text);
    } else {
      setEnd(point);
      setEndText(text);
    }
  };

  const findHelp = () => {
    const from = position ?? start;
    if (!from) {
      Alert.alert('Where are you?', 'Turn on location to find the nearest safe place.');
      return;
    }
    const near = nearestHaven(from.latitude, from.longitude);
    if (!near) return;
    Alert.alert(
      near.haven.n,
      `${HAVEN_KINDS[near.haven.t].label}, ${formatDistance(near.metres)} away. Open walking directions in Maps?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Directions',
          onPress: () =>
            Linking.openURL(`http://maps.apple.com/?daddr=${near.haven.y},${near.haven.x}&dirflg=w`),
        },
      ],
    );
  };

  const risk = candidate ? riskColours(t)[candidate.safety.score] : null;
  const note = plan && candidate ? comparisonNote(plan.candidates, selected) : null;
  const afterDark = isAfterDark(hour);
  const options = useMemo(
    () => (plan ? rankOptions(plan.candidates, plan.dataAvailable) : []),
    [plan],
  );

  return (
    <View style={[styles.fill, { backgroundColor: t.paper }]}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />

      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={NYC}
        customMapStyle={Platform.OS === 'android' ? (t.dark ? mapStyleDark : mapStyleLight) : undefined}
        showsUserLocation
        showsCompass={false}
        onRegionChangeComplete={setRegion}
        userInterfaceStyle={t.dark ? 'dark' : 'light'}
      >
        {plan?.candidates.map((c, i) =>
          i === selected ? null : (
            <Polyline
              key={`alt${i}`}
              coordinates={toLatLng(c.coords)}
              strokeColor={t.ink3}
              strokeWidth={4}
              lineCap="round"
              lineJoin="round"
              zIndex={1}
              tappable
              onPress={() => setSelected(i)}
            />
          ),
        )}
        {candidate && (
          <>
            {/* A pale edge keeps the route a solid line over any road or other route. */}
            <Polyline
              key={`edge${selected}`}
              coordinates={toLatLng(candidate.coords)}
              strokeColor={t.surface}
              strokeWidth={11}
              lineCap="round"
              lineJoin="round"
              zIndex={2}
            />
            <Polyline
              key={`route${selected}`}
              coordinates={toLatLng(candidate.coords)}
              strokeColor={t.blue}
              strokeWidth={7}
              lineCap="round"
              lineJoin="round"
              zIndex={3}
            />
          </>
        )}
        {crimesShown.map((c, i) => (
          <Circle
            key={`c${i}`}
            center={{ latitude: c.lat, longitude: c.lng }}
            radius={14}
            fillColor={`${t.red}88`}
            strokeColor={t.red}
            strokeWidth={1}
          />
        ))}
        {havens.map((h) => (
          <Marker
            key={`${h.n}${h.y}${h.x}`}
            coordinate={{ latitude: h.y, longitude: h.x }}
            title={h.n}
            description={HAVEN_KINDS[h.t].label}
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={[styles.haven, { backgroundColor: t.teal, borderColor: t.surface }]}>
              <Text style={styles.havenLetter}>{HAVEN_KINDS[h.t].letter}</Text>
            </View>
          </Marker>
        ))}
        {start && mode !== 'plan' && <Marker coordinate={start} title="Start" pinColor={t.blue} />}
        {end && <Marker coordinate={end} title="Destination" pinColor={t.orange} />}
      </MapView>

      {mode === 'results' && !topOpen ? (
        <Pressable
          onPress={() => {
            animate();
            setTopOpen(true);
          }}
          style={[
            styles.top,
            styles.compact,
            { top: insets.top + 8, backgroundColor: t.surface, borderColor: t.rule },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Show search"
        >
          <View style={[styles.dot, { backgroundColor: t.blue }]} />
          <Text style={[styles.compactText, { color: t.ink }]} numberOfLines={1}>
            {startText || 'Start'}
          </Text>
          <Text style={{ color: t.ink3 }}>→</Text>
          <View style={[styles.dot, { backgroundColor: t.orange }]} />
          <Text style={[styles.compactText, { color: t.ink }]} numberOfLines={1}>
            {endText || 'Destination'}
          </Text>
          <Text style={{ color: t.blue, fontWeight: '700', fontSize: 13 }}>Edit ▾</Text>
        </Pressable>
      ) : mode !== 'navigating' ? (
        <View
          style={[
            styles.top,
            { top: insets.top + 8, backgroundColor: t.surface, borderColor: t.rule },
          ]}
        >
          <PlaceField
            t={t}
            label="Start"
            dot={t.blue}
            value={startText}
            onChangeText={(x) => {
              setStartText(x);
              setStart(null);
            }}
            onPick={(p: Place) => {
              setStart({ latitude: p.latitude, longitude: p.longitude });
              setPlan(null);
              setMode('plan');
            }}
            trailing={
              <Pressable onPress={useMyLocation} hitSlop={10} accessibilityLabel="Use my location">
                <Text style={{ color: t.blue, fontWeight: '700', fontSize: 13 }}>GPS</Text>
              </Pressable>
            }
          />
          <View style={{ height: 8 }} />
          <PlaceField
            t={t}
            label="Where to?"
            dot={t.orange}
            value={endText}
            onChangeText={(x) => {
              setEndText(x);
              setEnd(null);
            }}
            onPick={(p: Place) => {
              setEnd({ latitude: p.latitude, longitude: p.longitude });
              setPlan(null);
              setMode('plan');
            }}
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.placeChips}
          >
            {['Home', 'Work'].map((slot) => {
              const saved = places.find((p) => p.name.toLowerCase() === slot.toLowerCase());
              return saved ? null : (
                <Pressable
                  key={slot}
                  onPress={() => setSettingsOpen(true)}
                  style={[styles.placeChip, { borderColor: t.ruleStrong, borderStyle: 'dashed' }]}
                >
                  <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>
                    ＋ {slot === 'Home' ? '🏠' : '💼'} {slot}
                  </Text>
                </Pressable>
              );
            })}
            {[...places]
              .sort((a, b) => rank(a.name) - rank(b.name))
              .map((place) => (
                <Pressable
                  key={place.id}
                  onPress={() => usePlace(place, false)}
                  onLongPress={() => usePlace(place, true)}
                  delayLongPress={400}
                  style={[styles.placeChip, { backgroundColor: t.surfaceSunk, borderColor: 'transparent' }]}
                  accessibilityHint="Tap to go there, press and hold to start from there"
                >
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>
                    {place.icon} {place.name}
                  </Text>
                </Pressable>
              ))}
          </ScrollView>

          <View style={styles.whenRow}>
            {(['now', 'night'] as const).map((choice) => (
              <Chip
                key={choice}
                t={t}
                active={departure === choice}
                label={choice === 'now' ? 'Now' : 'Tonight 10 PM'}
                onPress={() => {
                  setDeparture(choice);
                  setPickingTime(false);
                  setPlan(null);
                  setMode('plan');
                }}
              />
            ))}
            <Chip
              t={t}
              active={typeof departure === 'object'}
              label={typeof departure === 'object' ? formatClock(departureDate(departure)) : 'Pick time'}
              onPress={() => setPickingTime((v) => !v)}
            />
          </View>

          {pickingTime && (
            <DateTimePicker
              value={customDate}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              themeVariant={t.dark ? 'dark' : 'light'}
              onChange={(_, date) => {
                if (!date) {
                  setPickingTime(false);
                  return;
                }
                setCustomDate(date);
                setDeparture({ hour: date.getHours(), minute: date.getMinutes() });
                setPlan(null);
                setMode('plan');
                if (Platform.OS !== 'ios') setPickingTime(false);
              }}
            />
          )}

          {mode === 'plan' && (
            <Pressable
              onPress={findRoutes}
              disabled={loading}
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: t.blue, opacity: pressed || loading ? 0.75 : 1 },
              ]}
              accessibilityRole="button"
            >
              {loading ? (
                <ActivityIndicator color={t.onAccent} />
              ) : (
                <Text style={[styles.primaryText, { color: t.onAccent }]}>Find safest route</Text>
              )}
            </Pressable>
          )}

          {mode === 'results' && (
            <Pressable
              onPress={() => {
                animate();
                setTopOpen(false);
              }}
              style={styles.hide}
              accessibilityRole="button"
            >
              <Text style={{ color: t.blue, fontWeight: '700', fontSize: 13 }}>Hide search ▴</Text>
            </Pressable>
          )}

          {!!error && <Text style={[styles.error, { color: t.red }]}>{error}</Text>}
        </View>
      ) : (
        !!steps[stepIndex] && (
          <View style={[styles.nav, { top: insets.top + 8, backgroundColor: t.blue }]}>
            <ManeuverIcon
              type={steps[stepIndex].type}
              modifier={steps[stepIndex].modifier}
              size={40}
              color={t.onAccent}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.navText, { color: t.onAccent }]} numberOfLines={3}>
                {steps[stepIndex].instruction}
              </Text>
              {!!steps[stepIndex].distance && (
                <Text style={[styles.navSub, { color: t.onAccent, fontFamily: mono }]}>
                  {formatDistance(steps[stepIndex].distance)}
                </Text>
              )}
            </View>
          </View>
        )
      )}

      <View style={[styles.fabs, { bottom: mode === 'plan' ? insets.bottom + 24 : undefined, top: mode === 'plan' ? undefined : insets.top + (mode === 'results' && topOpen ? 140 : 76) }]} pointerEvents="box-none">
        <Pressable
          onPress={() => setSettingsOpen(true)}
          accessibilityLabel="Settings"
          style={[styles.fab, { backgroundColor: t.surface, borderColor: t.rule, marginBottom: 10 }]}
        >
          <Text style={{ color: t.ink, fontSize: 20 }}>⚙︎</Text>
        </Pressable>
        <Pressable
          onPress={() => update({ showHavens: !settings.showHavens })}
          accessibilityLabel="Toggle safe places"
          style={[styles.fab, { backgroundColor: showHavens ? t.teal : t.surface, borderColor: t.rule }]}
        >
          <Text style={{ color: showHavens ? t.onAccent : t.teal, fontWeight: '800' }}>P</Text>
        </Pressable>
      </View>

      {mode !== 'plan' && plan && candidate && risk && (
        <View
          style={[
            styles.sheet,
            { backgroundColor: t.surface, borderColor: t.rule, paddingBottom: insets.bottom + 12 },
          ]}
        >
          <Pressable
            onPress={() => {
              animate();
              setSheetOpen((v) => !v);
            }}
            hitSlop={12}
            style={styles.handleArea}
            accessibilityRole="button"
            accessibilityLabel={sheetOpen ? 'Collapse details' : 'Show details'}
          >
            <View style={[styles.handle, { backgroundColor: t.ruleStrong }]} />
            <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>
              {sheetOpen ? 'Hide details ▾' : 'Details ▴'}
            </Text>
          </Pressable>

          {mode === 'results' && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.options}
            >
              {options.map(({ index: i, tags }) => {
                const c = plan.candidates[i];
                const r = riskColours(t)[c.safety.score];
                const active = i === selected;
                return (
                  <Pressable
                    key={i}
                    onPress={() => setSelected(i)}
                    style={[
                      styles.option,
                      {
                        borderColor: active ? t.blue : t.rule,
                        backgroundColor: active ? t.blueTint : t.surface,
                      },
                    ]}
                  >
                    <Text style={[styles.optionTitle, { color: t.ink }]} numberOfLines={2}>
                      {tags.join(' · ')}
                    </Text>
                    <Text style={{ color: r.fg, fontSize: 12, fontWeight: '700' }}>{r.label}</Text>
                    <Text style={{ color: t.ink2, fontSize: 12, fontFamily: mono }}>
                      {routeMinutes(c.route)} min · {formatMiles(c.route.distance)}
                    </Text>
                    <Text style={{ color: t.ink3, fontSize: 12, fontFamily: mono }}>
                      arrive {arrivalTime(departure, routeMinutes(c.route))}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {(mode === 'navigating' || sheetOpen) && (
          <View style={styles.summary}>
            <View style={[styles.badge, { backgroundColor: risk.bg }]}>
              <Text style={{ color: risk.fg, fontWeight: '800', fontSize: 13 }}>{risk.label}</Text>
            </View>
            <Text style={[styles.minutes, { color: t.ink }]}>
              {mode === 'navigating' && remaining !== null
                ? formatDistance(remaining)
                : `${routeMinutes(candidate.route)} min`}
            </Text>
            <Text style={{ color: t.ink2, fontFamily: mono, fontSize: 13 }}>
              {mode === 'navigating'
                ? 'to go'
                : `${formatMiles(candidate.route.distance)} · arrive ${arrivalTime(departure, routeMinutes(candidate.route))}`}
            </Text>
          </View>
          )}

          {sheetOpen && (<>
          <Text style={[styles.reason, { color: t.ink2 }]}>{candidate.safety.reason}</Text>
          {!!note && <Text style={[styles.reason, { color: t.green, fontWeight: '700' }]}>{note}</Text>}
          {afterDark && settings.nightWarning && mode === 'results' && (
            <Text style={[styles.reason, { color: t.amber }]}>
              It will be dark. Keep to lit, busy streets and share your walk.
            </Text>
          )}
          {!plan.dataAvailable && (
            <Text style={[styles.reason, { color: t.amber }]}>
              Incident data could not be loaded, so these routes are not safety-scored.
            </Text>
          )}

          {mode === 'results' && (
            <ScrollView style={styles.steps} nestedScrollEnabled>
              {candidate.route.steps.map((s, i) => (
                <View key={i} style={styles.step}>
                  <ManeuverIcon type={s.type} modifier={s.modifier} size={20} color={t.ink2} />
                  <Text style={{ flex: 1, color: t.ink, fontSize: 14 }}>{s.instruction}</Text>
                  {!!s.distance && (
                    <Text style={{ color: t.ink3, fontFamily: mono, fontSize: 12 }}>
                      {formatDistance(s.distance)}
                    </Text>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
          </>)}

          {(sheetOpen || mode === 'navigating') && (
            <>
              <View style={styles.actions}>
                <Action t={t} label="Share" onPress={shareWalk} />
                <Action t={t} label="Safe place" onPress={findHelp} />
                {settings.showEmergency && (
                  <EmergencyButton
                    t={t}
                    holdToCall={settings.holdToCall}
                    holdMs={settings.holdMs}
                    haptics={settings.haptics}
                  />
                )}
              </View>
              {!!settings.contactPhone && (
                <View style={styles.actions}>
                  <Action t={t} label={`Text ${settings.contactName || 'contact'}`} onPress={textContact} />
                  <Action t={t} label="Call" onPress={callContact} />
                </View>
              )}
            </>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={edit}
              style={[styles.secondary, { borderColor: t.ruleStrong }]}
              accessibilityRole="button"
            >
              <Text style={{ color: t.ink, fontWeight: '700' }}>
                {mode === 'navigating' ? 'End walk' : 'Edit'}
              </Text>
            </Pressable>
            {mode === 'results' && (
              <Pressable
                onPress={startNavigation}
                style={[styles.primary, styles.start, { backgroundColor: t.blue }]}
                accessibilityRole="button"
              >
                <Text style={[styles.primaryText, { color: t.onAccent }]}>Start walking</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      <SettingsModal t={t} visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  );
}

function Chip({
  t,
  label,
  active,
  onPress,
}: {
  t: Theme;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: active ? t.blueTint : t.surfaceSunk, borderColor: active ? t.blue : 'transparent' },
      ]}
    >
      <Text style={{ color: active ? t.blue : t.ink2, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function Action({
  t,
  label,
  danger,
  onPress,
}: {
  t: Theme;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.action, { backgroundColor: danger ? t.redTint : t.surfaceSunk }]}
      accessibilityRole="button"
    >
      <Text style={{ color: danger ? t.red : t.ink, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.15,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 6,
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: {
    position: 'absolute',
    left: 12,
    right: 12,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    ...shadow,
  },
  placeChips: { gap: 8, paddingTop: 10 },
  placeChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1.5 },
  whenRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1.5 },
  primary: {
    marginTop: 12,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  start: { flex: 2, marginTop: 0 },
  primaryText: { fontSize: 16, fontWeight: '800' },
  secondary: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { marginTop: 10, fontSize: 13, fontWeight: '600' },
  nav: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.lg,
    ...shadow,
  },
  navText: { fontSize: 18, fontWeight: '700' },
  navSub: { fontSize: 14, marginTop: 2, opacity: 0.85 },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  compactText: { flex: 1, fontSize: 14, fontWeight: '600' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  hide: { alignSelf: 'center', paddingTop: 10, paddingBottom: 2 },
  handleArea: { alignItems: 'center', gap: 4, paddingBottom: 8 },
  handle: { width: 38, height: 4, borderRadius: 2 },
  fabs: { position: 'absolute', right: 16 },
  fab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  haven: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  havenLetter: { color: '#fff', fontSize: 10, fontWeight: '800' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 14,
    paddingHorizontal: 16,
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
    borderWidth: StyleSheet.hairlineWidth,
    ...shadow,
  },
  options: { gap: 8, paddingBottom: 10 },
  option: { width: 160, padding: 10, borderRadius: radius.md, borderWidth: 1.5, gap: 2 },
  optionTitle: { fontSize: 14, fontWeight: '800' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  minutes: { fontSize: 22, fontWeight: '800' },
  reason: { marginTop: 6, fontSize: 14, lineHeight: 19 },
  steps: { maxHeight: 130, marginTop: 6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  action: { flex: 1, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
