"""Bayesian inference: is the road blocked, given one noisy traffic sensor? (topic: probabilistic reasoning)"""


def posterior_blocked(prior, p_alert_if_blocked, p_alert_if_clear, alert):
    """Bayes' rule for one observation.

    P(Blocked | obs) = P(obs | Blocked) * P(Blocked) / P(obs)

    alert=True  -> the sensor raised an alert
    alert=False -> the sensor stayed silent (uses the complementary likelihoods)
    Returns (posterior, steps) where steps holds the intermediate numbers for printing.
    """
    like_blocked = p_alert_if_blocked if alert else 1 - p_alert_if_blocked
    like_clear = p_alert_if_clear if alert else 1 - p_alert_if_clear

    joint_blocked = like_blocked * prior          # P(obs, Blocked)
    joint_clear = like_clear * (1 - prior)        # P(obs, Clear)
    evidence = joint_blocked + joint_clear        # P(obs)
    posterior = joint_blocked / evidence

    steps = {
        "like_blocked": like_blocked,
        "like_clear": like_clear,
        "joint_blocked": joint_blocked,
        "joint_clear": joint_clear,
        "evidence": evidence,
    }
    return posterior, steps
